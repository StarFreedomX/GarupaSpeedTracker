import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { BestdoriSongMetadataService } from "@/services/songMetadataService";
import { type MusicDataResponse, Tag } from "@/types/bestdori/songs";
import type { SongLevelSummary } from "@/types/songMetadata";

jest.mock("@/services/songsService", () => ({ getSongsList: jest.fn() }));
jest.mock("@/logger", () => ({ logger: jest.fn() }));

const song: MusicDataResponse = {
    "782": {
        tag: Tag.Normal,
        bandId: 1,
        jacketImage: ["782_game_changer"],
        musicTitle: ["Game Changer", null, null, null, null],
        publishedAt: ["1774177200000", null, null, null, null],
        closedAt: [null, null, null, null, null],
        difficulty: {
            "0": { playLevel: 12 },
            "1": { playLevel: 16 },
            "2": { playLevel: 25 },
            "3": { playLevel: 29, scoreLevel: 28 },
            "4": { playLevel: 30 },
        },
    },
};
const counts = {
    "3.0": [1, 2, 3, 4, 5, 6],
    "3.5": [1, 2, 3, 4, 5, 6],
    "4.0": [1, 2, 3, 4, 5, 6],
    "4.5": [1, 2, 3, 4, 5, 6],
    "5.0": [1, 2, 3, 4, 5, 6],
    "5.5": [1, 2, 3, 4, 5, 6],
    "5.6": [1, 2, 3, 4, 5, 6],
    "5.7": [1, 2, 3, 4, 5, 6],
    "6.0": [1, 2, 3, 4, 5, 6],
    "6.2": [1, 2, 3, 4, 5, 6],
    "6.4": [1, 2, 3, 4, 5, 6],
    "6.5": [1, 2, 3, 4, 5, 6],
    "6.8": [1, 2, 3, 4, 5, 6],
    "7.0": [1, 2, 3, 4, 5, 6],
    "7.2": [1, 2, 3, 4, 5, 6],
    "7.5": [1, 2, 3, 4, 5, 6],
    "8.0": [1, 2, 3, 4, 5, 6],
} satisfies SongLevelSummary["counts"];
const cachedCharts: Record<string, SongLevelSummary> = Object.fromEntries(
    Object.entries(song["782"].difficulty).map(([key, diff]) => [key, { level: diff.playLevel, total: 1250, counts }]),
);
let dir: string;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "garupa-metadata-test-"));
});
afterEach(async () => {
    await fs.remove(dir);
});

async function writeLegacy() {
    await fs.writeJson(path.join(dir, "songs.json"), song);
    await fs.writeJson(path.join(dir, "songMetadata.json"), { sourceHash: "legacy", checkedAt: Date.now(), chartCount: 5, chartMeta: { "782": cachedCharts } });
}

test("migrates a fresh legacy cache and reuses note counts with the corrected scoreLevel", async () => {
    await writeLegacy();
    const fetchSongs = jest.fn().mockResolvedValue(song);
    const download = jest.fn().mockRejectedValue(new Error("should not need charts"));
    const service = new BestdoriSongMetadataService({ dataDir: dir }, { fetchSongs, downloader: { download, downloadCache: download } });
    const data = await service.getSongMetadata();
    expect(data[782]["3"]).toEqual({ ...cachedCharts["3"], level: 29, scoreLevel: 28 });
    expect(fetchSongs).toHaveBeenCalledTimes(1);
    expect(download).not.toHaveBeenCalled();
    expect((await fs.readJson(path.join(dir, "songMetadata.json"))).version).toBe(2);
});

test("detects scoreLevel-only changes even when playLevel is unchanged", async () => {
    await writeLegacy();
    const fetchSongs = jest.fn().mockResolvedValue(song);
    const service = new BestdoriSongMetadataService({ dataDir: dir, checkIntervalMs: 0 }, { fetchSongs });
    await service.getSongMetadata();
    const updated = structuredClone(song);
    updated["782"].difficulty["3"].scoreLevel = 27;
    fetchSongs.mockResolvedValue(updated);
    expect((await service.getSongMetadata())[782]["3"].scoreLevel).toBe(27);
});

test("builds metadata when songs.json exists but chart metadata is missing", async () => {
    await fs.writeJson(path.join(dir, "songs.json"), song);
    const download = jest
        .fn()
        .mockResolvedValue([
            { type: "BPM", beat: 0, bpm: 120 },
            ...Array.from({ length: 6 }, (_, i) => ({ type: "Single", beat: 20 * (i + 1), lane: 0, skill: true })),
        ]);
    const service = new BestdoriSongMetadataService({ dataDir: dir }, { fetchSongs: async () => song, downloader: { download, downloadCache: download } });
    const data = await service.getSongMetadata();
    expect(Object.keys(data[782])).toEqual(["0", "1", "2", "3", "4"]);
    expect(data[782]["3"]).toMatchObject({ level: 29, scoreLevel: 28 });
    expect(data[782]["4"]).toMatchObject({ level: 30, scoreLevel: 30 });
    expect(download).toHaveBeenCalledTimes(5);
});
