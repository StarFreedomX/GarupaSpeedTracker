import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BestdoriChartParser } from "@/parsers/BestdoriChartParser";
import { BestdoriSongLevelParser } from "@/parsers/BestdoriSongLevelParser";
import { BestdoriSongMetadataService } from "@/services/songMetadataService";
import type { Chart } from "@/types/bestdori/chart";
import type { MusicDataResponse } from "@/types/bestdori/songs";
import { Tag } from "@/types/bestdori/songs";

describe("BestdoriSongMetadataService", () => {
    it("syncs all available difficulties, stores raw charts, and avoids refetching charts when the source hash stays the same", async () => {
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "gst-song-metadata-"));
        const chart: Chart = [
            { type: "BPM", bpm: 120, beat: 0 },
            { type: "Single", lane: 1, beat: 1, skill: true },
            { type: "Single", lane: 2, beat: 2 },
        ];
        const musicData: MusicDataResponse = {
            "1": {
                tag: Tag.Normal,
                bandId: 1,
                jacketImage: ["jacket-1"],
                musicTitle: ["Song A"],
                publishedAt: [null],
                closedAt: [null],
                difficulty: { "0": { playLevel: 10 }, "1": { playLevel: 11 }, "2": { playLevel: 12 }, "3": { playLevel: 13 }, "4": { playLevel: 14 } },
            },
            "2": {
                tag: Tag.Anime,
                bandId: 2,
                jacketImage: ["jacket-2"],
                musicTitle: ["Song B"],
                publishedAt: [null],
                closedAt: [null],
                difficulty: { "0": { playLevel: 20 }, "1": { playLevel: 21 }, "2": { playLevel: 22 }, "3": { playLevel: 23 } },
            },
        };
        let downloadCount = 0;
        let downloadCacheCount = 0;
        const downloader = {
            download: async <T>(_url: string): Promise<T> => {
                downloadCount += 1;
                return chart as unknown as T;
            },
            downloadCache: async <T>(_url: string, _options?: unknown): Promise<T> => {
                downloadCacheCount += 1;
                return musicData as unknown as T;
            },
        };
        const service = new BestdoriSongMetadataService(
            { dataDir, rawChartStorage: true, checkIntervalMs: 0, concurrency: 2 },
            { downloader, chartParser: new BestdoriChartParser(), levelParser: new BestdoriSongLevelParser() },
        );

        const first = await service.getSongMetadata();
        const second = await service.getSongMetadata();

        expect(first[1]).toBeDefined();
        expect(first[2]).toBeDefined();
        expect(first[1][10]).toBeDefined();
        expect(first[1][14]).toBeDefined();
        expect(first[2][20]).toBeDefined();
        expect(first[2][23]).toBeDefined();
        expect(first[1][10].total).toEqual(2);
        expect(second).toEqual(first);
        expect(downloadCacheCount).toEqual(2);
        expect(downloadCount).toEqual(9);
        expect(JSON.parse(await fs.readFile(path.join(dataDir, "bestdori-song-summaries.json"), "utf8"))).toMatchObject({
            chartCount: 9,
            chartMeta: first,
        });
        const rawChartStat = await fs.stat(path.join(dataDir, "raw", "charts", "1", "expert.json"));
        expect(rawChartStat.isFile()).toEqual(true);
    });
});
