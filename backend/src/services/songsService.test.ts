import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { SongsService, supplementJpSongs } from "@/services/songsService";
import { type MusicDataResponse, Tag } from "@/types/bestdori/songs";

jest.mock("@/api/garupaMusic", () => ({ fetchGarupaSongs: jest.fn() }));
jest.mock("@/api/bestdori", () => ({ fetchBestdoriSongs: jest.fn() }));
jest.mock("@/logger", () => ({ logger: jest.fn() }));

const jp: MusicDataResponse = {
    "782": {
        tag: Tag.Normal,
        bandId: 1,
        jacketImage: ["jp-jacket"],
        musicTitle: ["Game Changer", null, null, null, null],
        publishedAt: ["0", null, null, null, null],
        closedAt: ["4122068400000", null, null, null, null],
        difficulty: {
            "0": { playLevel: 12 },
            "1": { playLevel: 16 },
            "2": { playLevel: 25 },
            "3": { playLevel: 29, scoreLevel: 28, publishedAt: ["1774177200000", null, null, null, null] },
            "4": { playLevel: 30 },
        },
    },
};
const bestdori: MusicDataResponse = {
    "782": {
        ...jp["782"],
        bandId: 9,
        jacketImage: ["wrong-jacket"],
        musicTitle: ["wrong-title", "English", null, "简体中文", "한국어"],
        publishedAt: ["999", "123", null, "456", "789"],
        closedAt: ["999", null, "4122068400002", null, "4122068400004"],
        difficulty: {
            "0": { playLevel: 12 },
            "1": { playLevel: 16 },
            "2": { playLevel: 25 },
            "3": { playLevel: 29, publishedAt: ["999", "123", null, "456", "789"] },
            "4": { playLevel: 30 },
        },
        musicVideos: { music_video_1: { startAt: ["123", null, "456", null, "789"] } },
    },
};

let dir: string;
beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "garupa-songs-test-"));
});
afterEach(async () => {
    await fs.remove(dir);
});

test("supplements metadata without replacing JP fields, catalog or difficulties", () => {
    const original = structuredClone(jp);
    const merged = supplementJpSongs(jp, { ...bestdori, "999": bestdori["782"] });
    expect(Object.keys(merged)).toEqual(["782"]);
    expect(merged["782"]).toMatchObject({ bandId: 1, jacketImage: ["jp-jacket"] });
    expect(merged["782"].musicTitle).toEqual(["Game Changer", "English", null, "简体中文", "한국어"]);
    expect(merged["782"].publishedAt).toEqual(["0", "123", null, "456", "789"]);
    expect(merged["782"].closedAt).toEqual(["4122068400000", null, "4122068400002", null, "4122068400004"]);
    expect(merged["782"].difficulty["3"]).toEqual({ playLevel: 29, scoreLevel: 28, publishedAt: ["1774177200000", "123", null, "456", "789"] });
    expect(merged["782"].difficulty["4"]).toEqual({ playLevel: 30 });
    expect(merged["782"].musicVideos?.music_video_1.startAt).toEqual(["123", null, "456", null, "789"]);
    expect(jp).toEqual(original);
});

test("cold start persists JP data and concurrent callers share one request", async () => {
    const fetchJp = jest.fn().mockResolvedValue(jp);
    const service = new SongsService(dir, fetchJp, jest.fn().mockResolvedValue(bestdori));
    const [a, b] = await Promise.all([service.getSongsList(), service.getSongsList()]);
    expect(a).toEqual(b);
    expect(fetchJp).toHaveBeenCalledTimes(1);
    const restarted = new SongsService(dir, jest.fn().mockRejectedValue(new Error("offline")));
    expect(await restarted.getSongsList()).toEqual(a);
});

test("Bestdori outage does not block JP songs", async () => {
    const service = new SongsService(dir, async () => structuredClone(jp), jest.fn().mockRejectedValue(new Error("offline")));
    expect((await service.getSongsList())["782"].difficulty["3"].scoreLevel).toBe(28);
});

test("JP failure retains only a previously verified JP snapshot", async () => {
    const fetchJp = jest.fn().mockResolvedValueOnce(jp).mockRejectedValue(new Error("JP offline"));
    const service = new SongsService(dir, fetchJp, jest.fn().mockResolvedValue(bestdori), 0);
    const first = await service.getSongsList();
    expect(await service.getSongsList()).toEqual(first);
    await fs.remove(path.join(dir, "jpSongs.json"));
    await fs.writeJson(path.join(dir, "songs.json"), bestdori);
    const cold = new SongsService(dir, fetchJp, jest.fn().mockResolvedValue(bestdori));
    await expect(cold.getSongsList()).rejects.toThrow("JP offline");
});

test.each([1, 2, 3, 4])("keeps supplemental values at server index %i", (server) => {
    const extra = structuredClone(bestdori);
    const slots: (string | null)[] = [null, null, null, null, null];
    slots[server] = `server-${server}`;
    extra["782"].musicTitle = slots;
    const expected: (string | null)[] = ["Game Changer", null, null, null, null];
    expected[server] = `server-${server}`;
    expect(supplementJpSongs(jp, extra)["782"].musicTitle).toEqual(expected);
});

test("does not add a difficulty absent from the JP catalog", () => {
    const jpWithoutSpecial = structuredClone(jp);
    delete jpWithoutSpecial["782"].difficulty["4"];
    expect(supplementJpSongs(jpWithoutSpecial, bestdori)["782"].difficulty["4"]).toBeUndefined();
});

test("keeps JP playLevel when supplementary data disagrees", () => {
    const conflicting = structuredClone(bestdori);
    conflicting["782"].difficulty["3"].playLevel = 30;
    conflicting["782"].difficulty["4"] = { playLevel: 31 };
    const merged = supplementJpSongs(jp, conflicting);
    expect(merged["782"].difficulty["3"]).toMatchObject({ playLevel: 29, scoreLevel: 28 });
    expect(merged["782"].difficulty["4"]).toEqual({ playLevel: 30 });
});
