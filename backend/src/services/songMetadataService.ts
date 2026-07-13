import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import pLimit from "p-limit";
import { fetchBestdoriChart, fetchBestdoriSongs } from "@/api/bestdori";
import { BESTDORI_SONGS_CHECK_INTERVAL_MS, BESTDORI_STORE_RAW_CHARTS } from "@/config";
import { logger } from "@/logger";
import { BestdoriChartParser } from "@/parsers/BestdoriChartParser";
import { BestdoriSongLevelParser } from "@/parsers/BestdoriSongLevelParser";
import { type DownloadCacheOptions, downloader } from "@/storage/downloader";
import type { Chart } from "@/types/bestdori/chart";
import type { DifficultyKey, MusicDataResponse, MusicItem } from "@/types/bestdori/songs";
import type { SongChartMeta, SongSummary } from "@/types/songMetadata";

interface DownloaderLike {
    download<T>(url: string): Promise<T>;
    downloadCache<T>(url: string, options?: DownloadCacheOptions<T>): Promise<T>;
}

interface Options {
    dataDir?: string;
    rawChartStorage?: boolean;
    checkIntervalMs?: number;
    concurrency?: number;
}

interface State {
    chartMeta: SongChartMeta;
    sourceHash: string;
    checkedAt: number;
    chartCount: number;
}

interface PersistedDataset {
    sourceHash: string;
    checkedAt: number;
    chartCount: number;
    chartMeta: SongChartMeta;
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const METADATA_FILENAME = "songMetadata.json";
const SONGS_FILENAME = "songs.json";
const RAW_DIR = path.join("raw", "charts");
const DIFFICULTY_ORDER: ReadonlyArray<{ key: DifficultyKey; name: string }> = [
    { key: "0", name: "easy" },
    { key: "1", name: "normal" },
    { key: "2", name: "hard" },
    { key: "3", name: "expert" },
    { key: "4", name: "special" },
];

/**
 * Normalizes a music item to a stable representation for hash comparison.
 *
 * Only the fields relevant to song identity are included (tag, band, jacket,
 * title, publish dates, difficulty levels). This ensures that minor data
 * differences (e.g. order of keys) do not cause false hash mismatches.
 *
 * @param music - The raw music item from Bestdori.
 * @returns A plain object with normalized fields.
 */
const normalizeMusicItem = (music: MusicItem): Record<string, unknown> => ({
    tag: music.tag,
    bandId: music.bandId,
    jacketImage: [...music.jacketImage],
    musicTitle: [...music.musicTitle],
    publishedAt: [...music.publishedAt],
    closedAt: [...music.closedAt],
    difficulty: {
        0: music.difficulty["0"]?.playLevel ?? null,
        1: music.difficulty["1"]?.playLevel ?? null,
        2: music.difficulty["2"]?.playLevel ?? null,
        3: music.difficulty["3"]?.playLevel ?? null,
        4: music.difficulty["4"]?.playLevel ?? null,
    },
});

/**
 * Computes a SHA-1 hash of the normalized song data for change detection.
 *
 * Songs are sorted by numeric ID before hashing to ensure deterministic output.
 *
 * @param payload - The raw music data response from Bestdori.
 * @returns A hex-encoded SHA-1 digest.
 */
const hashSongs = (payload: MusicDataResponse): string => {
    const normalized = Object.fromEntries(
        Object.entries(payload)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([songId, music]) => [songId, normalizeMusicItem(music)]),
    );
    return createHash("sha1").update(JSON.stringify(normalized)).digest("hex");
};

/**
 * Safely reads and parses a JSON file, returning undefined on any error.
 *
 * @param filePath - Absolute path to the JSON file.
 * @returns The parsed value, or undefined if the file does not exist or is malformed.
 */
const readJson = async <T>(filePath: string): Promise<T | undefined> => {
    try {
        if (!(await fs.pathExists(filePath))) {
            return undefined;
        }

        return (await fs.readJson(filePath)) as T;
    } catch (error: unknown) {
        const nodeError = error as NodeJS.ErrnoException;
        logger("bestdori", `failed to read ${filePath}: ${nodeError.message ?? "unknown error"}`);
        return undefined;
    }
};

/**
 * Atomically writes a JSON value to disk via a temp-file + rename strategy.
 *
 * Retries on `EBUSY` errors (up to the specified number of retries) with
 * increasing backoff delays.
 *
 * @param filePath - Destination file path.
 * @param value - The value to serialize as JSON.
 * @param retries - Maximum retry attempts on `EBUSY` (default 3).
 */
const writeJson = async (filePath: string, value: unknown, retries = 3): Promise<void> => {
    await fs.ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    await fs.writeJson(tempPath, value, { spaces: 2 });
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            await fs.move(tempPath, filePath, { overwrite: true });
            return;
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === "EBUSY" && attempt < retries - 1) {
                await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
};

/**
 * Fetches all songs and charts from Bestdori with concurrency control,
 * computes chart difficulty summaries, and persists results to a disk cache.
 *
 * The service performs incremental updates: it compares the SHA-1 hash of the
 * normalized song data against the last known hash, and only re-fetches charts
 * for songs that are new or have changed. Raw chart JSON files can optionally
 * be stored on disk to speed up subsequent runs.
 *
 * The check interval controls how often a full re-check is allowed; within the
 * interval, cached metadata is returned immediately.
 */
export class BestdoriSongMetadataService {
    private readonly downloader: DownloaderLike;
    private readonly chartParser: BestdoriChartParser;
    private readonly levelParser: BestdoriSongLevelParser;
    private readonly dataDir: string;
    private readonly metadataPath: string;
    private readonly songsPath: string;
    private readonly rawDir: string;
    private readonly rawChartStorage: boolean;
    private readonly checkIntervalMs: number;
    private readonly concurrency: number;

    private state: State | undefined;
    private syncPromise: Promise<SongChartMeta> | undefined;

    /**
     * @param options - Configuration overrides.
     * @param options.dataDir - Base directory for cache data (default: `cwd/data`).
     * @param options.rawChartStorage - Whether to persist raw chart JSON files (default: from config).
     * @param options.checkIntervalMs - Minimum interval between full re-checks (default: from config).
     * @param options.concurrency - Max concurrent chart fetch operations (default: 50).
     * @param deps - Injectable dependencies for testing.
     */
    public constructor(
        options: Options = {},
        deps?: Partial<{ downloader: DownloaderLike; chartParser: BestdoriChartParser; levelParser: BestdoriSongLevelParser }>,
    ) {
        this.downloader = deps?.downloader ?? downloader;
        this.chartParser = deps?.chartParser ?? new BestdoriChartParser();
        this.levelParser = deps?.levelParser ?? new BestdoriSongLevelParser();
        this.dataDir = options.dataDir ?? DATA_DIR;
        this.metadataPath = path.join(this.dataDir, METADATA_FILENAME);
        this.songsPath = path.join(this.dataDir, SONGS_FILENAME);
        this.rawDir = path.join(this.dataDir, RAW_DIR);
        this.rawChartStorage = options.rawChartStorage ?? BESTDORI_STORE_RAW_CHARTS;
        this.checkIntervalMs = options.checkIntervalMs ?? BESTDORI_SONGS_CHECK_INTERVAL_MS;
        this.concurrency = options.concurrency ?? 50;
    }

    /**
     * Returns the current chart metadata, triggering a refresh if the cached
     * data is stale (past the check interval) or not yet loaded.
     *
     * @returns The full chart metadata map (song ID → difficulty → summary).
     */
    public async getSongMetadata(): Promise<SongChartMeta> {
        await this.loadState();
        if (!this.state || this.shouldRefresh(this.state.checkedAt)) return this.syncSongMetadata();
        return this.state.chartMeta;
    }

    /**
     * Loads persisted state from the metadata JSON file.
     *
     * If the file is missing, malformed, or contains corrupted data, the state
     * is reset so the next call triggers a full re-sync.
     */
    private async loadState(): Promise<void> {
        if (this.state) return;
        const dataset = await readJson<PersistedDataset>(this.metadataPath);
        if (dataset?.chartMeta && dataset.checkedAt) {
            this.state = {
                chartMeta: dataset.chartMeta,
                sourceHash: dataset.sourceHash,
                checkedAt: dataset.checkedAt,
                chartCount: dataset.chartCount,
            };
        } else {
            if (dataset) {
                logger("bestdori", `detected corrupted metadata file at ${this.metadataPath}, re-generating...`);
            }
            this.state = undefined;
        }
    }

    /**
     * Checks whether the cached data has exceeded the configured check interval.
     *
     * A non-positive interval (≤ 0) forces a refresh on every call.
     *
     * @param checkedAt - The timestamp of the last successful check.
     * @returns True if a refresh is due.
     */
    private shouldRefresh(checkedAt: number): boolean {
        return this.checkIntervalMs <= 0 || Date.now() - checkedAt >= this.checkIntervalMs;
    }

    /**
     * Ensures only one sync operation runs at a time by reusing an in-flight
     * promise.
     *
     * @returns The chart metadata from the current or pending sync.
     */
    private async syncSongMetadata(): Promise<SongChartMeta> {
        if (this.syncPromise) return this.syncPromise;
        this.syncPromise = this.performSync().finally(() => {
            this.syncPromise = undefined;
        });
        return this.syncPromise;
    }

    /**
     * Performs the full sync: fetches the song list, detects changes via hash
     * comparison, re-fetches charts only for changed/new songs, updates metadata,
     * and persists everything to disk.
     *
     * @returns The updated chart metadata.
     */
    private async performSync(): Promise<SongChartMeta> {
        await fs.ensureDir(this.dataDir);
        logger("bestdori", "checking Bestdori song summary source...");

        // Load old songs data before overwriting, so we can detect changed songs
        const oldMusicData = await readJson<MusicDataResponse>(this.songsPath);

        const musicData = await fetchBestdoriSongs(
            {
                getExpireAt: () => Date.now() + Math.max(this.checkIntervalMs, 0),
                fallbackTtlMs: Math.max(this.checkIntervalMs, 0),
            },
            this.downloader,
        );
        const sourceHash = hashSongs(musicData);
        const now = Date.now();

        if (this.state?.sourceHash === sourceHash) {
            this.state = { ...this.state, checkedAt: now };
            await this.persistState();
            logger("bestdori", `song summary already up to date: songs=${Object.keys(musicData).length}, charts=${this.state.chartCount}`);
            return this.state.chartMeta;
        }
        await writeJson(this.songsPath, musicData);

        // Detect which songs changed (new or modified) vs the old snapshot
        const changedSongIds: string[] = [];
        for (const songId of Object.keys(musicData)) {
            if (!oldMusicData?.[songId]) {
                changedSongIds.push(songId); // New song
            } else {
                const oldNorm = JSON.stringify(normalizeMusicItem(oldMusicData[songId]));
                const newNorm = JSON.stringify(normalizeMusicItem(musicData[songId]));
                if (oldNorm !== newNorm) {
                    changedSongIds.push(songId); // Modified song
                }
            }
        }

        // Start from existing chart metadata to preserve unchanged songs
        const chartMeta: SongChartMeta = { ...(this.state?.chartMeta ?? {}) };

        // Remove songs that no longer exist in the new data
        if (oldMusicData) {
            for (const songId of Object.keys(oldMusicData)) {
                if (!musicData[songId]) {
                    delete chartMeta[Number(songId)];
                }
            }
        }

        if (changedSongIds.length === 0) {
            // No songs changed — only deletions may have occurred; just update hash/time
            const chartCount = Object.values(chartMeta).reduce((sum, s) => sum + Object.keys(s).length, 0);
            this.state = { chartMeta, sourceHash, checkedAt: now, chartCount };
            await this.persistState();
            logger("bestdori", `song summary up to date (no chart changes): songs=${Object.keys(musicData).length}, charts=${chartCount}`);
            return chartMeta;
        }

        const levelsMap = this.levelParser.buildSongLevelMap(musicData);
        const limit = pLimit(Math.max(1, Math.floor(this.concurrency)));

        logger("bestdori", `incremental chart update: ${changedSongIds.length} song(s) changed out of ${Object.keys(musicData).length} total`);

        const items = await Promise.all(
            changedSongIds.map((songId) =>
                limit(async () => {
                    const music = musicData[songId];
                    const songNumericId = Number(songId);
                    const levels = levelsMap[songId] ?? [
                        music.difficulty["0"]?.playLevel ?? 0,
                        music.difficulty["1"]?.playLevel ?? 0,
                        music.difficulty["2"]?.playLevel ?? 0,
                        music.difficulty["3"]?.playLevel ?? 0,
                    ];
                    const { summary, chartCount } = await this.buildSongSummary(songNumericId, music, levels);
                    return { songId: songNumericId, summary, chartCount };
                }),
            ),
        );

        // Start from existing chart count and adjust for changes
        let chartCount = this.state?.chartCount ?? 0;
        for (const item of items) {
            // Subtract old chart count for this song if it had one
            const oldSummary = chartMeta[item.songId];
            if (oldSummary) {
                chartCount -= Object.keys(oldSummary).length;
            }
            chartCount += item.chartCount;
            chartMeta[item.songId] = item.summary;
        }

        this.state = { chartMeta, sourceHash, checkedAt: now, chartCount };
        await this.persistState();
        logger(
            "bestdori",
            `song summary updated: songs=${Object.keys(musicData).length}, charts=${chartCount}, changed=${changedSongIds.length}, raw=${this.rawChartStorage ? "on" : "off"}`,
        );
        return chartMeta;
    }

    /**
     * Builds a difficulty-level summary for a single song by fetching and
     * analyzing its chart data for each available difficulty.
     *
     * Charts are either read from the local raw cache (if enabled and present)
     * or fetched from the Bestdori API. Failed chart fetches are logged and
     * skipped without failing the entire song.
     *
     * @param songId - The numeric song ID.
     * @param music - The song's music item from Bestdori.
     * @param levels - Pre-computed play levels from the level parser.
     * @returns The song summary object and the number of charts successfully processed.
     */
    private async buildSongSummary(songId: number, music: MusicItem, levels: number[]): Promise<{ summary: SongSummary; chartCount: number }> {
        const summary = {} as SongSummary;
        let chartCount = 0;

        for (let index = 0; index < DIFFICULTY_ORDER.length; index += 1) {
            const definition = DIFFICULTY_ORDER[index];
            const difficulty = music.difficulty[definition.key];
            if (!difficulty) continue;

            let chart: Chart;
            const chartPath = path.join(this.rawDir, String(songId), `${definition.name}.json`);
            try {
                // Read local chart file if caching is enabled and the file exists
                if (this.rawChartStorage && (await fs.pathExists(chartPath))) {
                    chart = await fs.readJson(chartPath);
                } else {
                    chart = await fetchBestdoriChart(songId, definition.name, this.downloader);
                    if (this.rawChartStorage) {
                        await writeJson(chartPath, chart);
                    }
                }
            } catch (error: unknown) {
                const nodeError = error as { message?: string };
                logger("bestdori", `chart fetch failed song=${songId} difficulty=${definition.name}: ${nodeError.message ?? "unknown error"}`);
                continue;
            }

            chartCount += 1;

            const level = levels[index] ?? difficulty.playLevel;
            summary[definition.key] = this.chartParser.buildLevelSummary(chart, level);
        }

        return { summary, chartCount };
    }

    /**
     * Persists the current in-memory state to the metadata JSON file atomically.
     */
    private async persistState(): Promise<void> {
        if (!this.state) {
            return;
        }

        const payload: PersistedDataset = {
            sourceHash: this.state.sourceHash,
            checkedAt: this.state.checkedAt,
            chartCount: this.state.chartCount,
            chartMeta: this.state.chartMeta,
        };
        await writeJson(this.metadataPath, payload);
    }
}

export const songMetadataService = new BestdoriSongMetadataService();
export const getSongMetadata = async (): Promise<SongChartMeta> => songMetadataService.getSongMetadata();
