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

const hashSongs = (payload: MusicDataResponse): string => {
    const normalized = Object.fromEntries(
        Object.entries(payload)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([songId, music]) => [songId, normalizeMusicItem(music)]),
    );
    return createHash("sha1").update(JSON.stringify(normalized)).digest("hex");
};

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

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
    await fs.ensureDir(path.dirname(filePath));
    const tempPath = `${filePath}.tmp`;
    await fs.writeJson(tempPath, value, { spaces: 2 });
    await fs.move(tempPath, filePath, { overwrite: true });
};

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

    public async getSongMetadata(): Promise<SongChartMeta> {
        await this.loadState();
        if (!this.state || this.shouldRefresh(this.state.checkedAt)) return this.syncSongMetadata();
        return this.state.chartMeta;
    }

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

    private shouldRefresh(checkedAt: number): boolean {
        return this.checkIntervalMs <= 0 || Date.now() - checkedAt >= this.checkIntervalMs;
    }

    private async syncSongMetadata(): Promise<SongChartMeta> {
        if (this.syncPromise) return this.syncPromise;
        this.syncPromise = this.performSync().finally(() => {
            this.syncPromise = undefined;
        });
        return this.syncPromise;
    }

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

    private async buildSongSummary(songId: number, music: MusicItem, levels: number[]): Promise<{ summary: SongSummary; chartCount: number }> {
        const summary = {} as SongSummary;
        let chartCount = 0;

        for (let index = 0; index < DIFFICULTY_ORDER.length; index += 1) {
            const definition = DIFFICULTY_ORDER[index];
            const difficulty = music.difficulty[definition.key];
            if (!difficulty) continue;

            let chart: Chart;
            try {
                chart = await fetchBestdoriChart(songId, definition.name, this.downloader);
            } catch (error: unknown) {
                const nodeError = error as { message?: string };
                logger("bestdori", `chart fetch failed song=${songId} difficulty=${definition.name}: ${nodeError.message ?? "unknown error"}`);
                continue;
            }

            chartCount += 1;
            if (this.rawChartStorage) {
                await writeJson(path.join(this.rawDir, String(songId), `${definition.name}.json`), chart);
            }

            const level = levels[index] ?? difficulty.playLevel;
            summary[definition.key] = this.chartParser.buildLevelSummary(chart, level);
        }

        return { summary, chartCount };
    }

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
