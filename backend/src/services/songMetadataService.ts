import { createHash } from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import pLimit from "p-limit";
import { BESTDORI_API, BESTDORI_SONGS_CHECK_INTERVAL_MS, BESTDORI_STORE_RAW_CHARTS } from "@/config";
import { logger } from "@/logger";
import { BestdoriChartParser } from "@/parsers/BestdoriChartParser";
import { BestdoriSongLevelParser } from "@/parsers/BestdoriSongLevelParser";
import { type DownloadCacheOptions, downloader } from "@/storage/downloader";
import type { Chart } from "@/types/bestdori/chart";
import type { MusicDataResponse, MusicItem } from "@/types/bestdori/songs";
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

type DifficultyKey = "0" | "1" | "2" | "3" | "4";

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
const DATASET_FILE = "bestdori-song-summaries.json";
const RAW_DIR = path.join("raw", "charts");
const DIFFICULTY_ORDER: ReadonlyArray<{ key: DifficultyKey; name: string }> = [
    { key: "0", name: "easy" },
    { key: "1", name: "normal" },
    { key: "2", name: "hard" },
    { key: "3", name: "expert" },
    { key: "4", name: "special" },
];

const buildSongsUrl = (): string => `${BESTDORI_API}songs/all.5.json`;
const buildChartUrl = (songId: number, difficultyName: string): string => `${BESTDORI_API}charts/${songId}/${difficultyName}.json`;

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
    private readonly datasetPath: string;
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
        this.datasetPath = path.join(this.dataDir, DATASET_FILE);
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
        const dataset = await readJson<PersistedDataset>(this.datasetPath);
        if (dataset) {
            this.state = {
                chartMeta: dataset.chartMeta,
                sourceHash: dataset.sourceHash,
                checkedAt: dataset.checkedAt,
                chartCount: dataset.chartCount,
            };
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

        const musicData = await this.downloader.downloadCache<MusicDataResponse>(buildSongsUrl(), {
            getExpireAt: () => Date.now() + Math.max(this.checkIntervalMs, 0),
            fallbackTtlMs: Math.max(this.checkIntervalMs, 0),
        });
        const sourceHash = hashSongs(musicData);
        const now = Date.now();

        if (this.state?.sourceHash === sourceHash) {
            this.state = { ...this.state, checkedAt: now };
            await this.persistState();
            logger(
                "bestdori",
                `song summary already up to date: songs=${Object.keys(musicData).length}, charts=${this.state.chartCount}`,
            );
            return this.state.chartMeta;
        }

        const levelsMap = this.levelParser.buildSongLevelMap(musicData);
        const limit = pLimit(Math.max(1, Math.floor(this.concurrency)));
        const songIds = Object.keys(musicData).sort((a, b) => Number(a) - Number(b));

        const items = await Promise.all(
            songIds.map((songId) =>
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

        let chartCount = 0;
        const chartMeta: SongChartMeta = {};
        for (const item of items) {
            chartCount += item.chartCount;
            chartMeta[item.songId] = item.summary;
        }

        this.state = { chartMeta, sourceHash, checkedAt: now, chartCount };
        await this.persistState();
        logger(
            "bestdori",
            `song summary updated: songs=${songIds.length}, charts=${chartCount}, raw=${this.rawChartStorage ? "on" : "off"}`,
        );
        return chartMeta;
    }

    private async buildSongSummary(songId: number, music: MusicItem, levels: number[]): Promise<{ summary: SongSummary; chartCount: number }> {
        const summary: SongSummary = {};
        let chartCount = 0;

        for (let index = 0; index < DIFFICULTY_ORDER.length; index += 1) {
            const definition = DIFFICULTY_ORDER[index];
            const difficulty = music.difficulty[definition.key];
            if (!difficulty) continue;

            let chart: Chart;
            try {
                chart = await this.downloader.download<Chart>(buildChartUrl(songId, definition.name));
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
            summary[level] = this.chartParser.buildLevelSummary(chart);
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
        await writeJson(this.datasetPath, payload);
    }
}

export const songMetadataService = new BestdoriSongMetadataService();
export const getSongMetadata = async (): Promise<SongChartMeta> => songMetadataService.getSongMetadata();
