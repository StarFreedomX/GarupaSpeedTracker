import { BestdoriSongLevelParser } from "@/parsers/BestdoriSongLevelParser";
import type { MusicDataResponse } from "@/types/bestdori/songs";
import { Tag } from "@/types/bestdori/songs";

describe("BestdoriSongLevelParser", () => {
    it("returns an empty map for empty payload", () => {
        const parser = new BestdoriSongLevelParser();

        expect(parser.buildSongLevelMap({})).toEqual({});
    });

    it("keeps difficulty order and repeated levels", () => {
        const parser = new BestdoriSongLevelParser();
        const payload: MusicDataResponse = {
            "1": {
                tag: Tag.Normal,
                bandId: 1,
                jacketImage: [],
                musicTitle: ["Song A"],
                publishedAt: [null],
                closedAt: [null],
                difficulty: {
                    "0": { playLevel: 27 },
                    "1": { playLevel: 23 },
                    "2": { playLevel: 27 },
                    "3": { playLevel: 30 },
                    "4": { playLevel: 23 },
                },
            },
            "2": {
                tag: Tag.Anime,
                bandId: 2,
                jacketImage: [],
                musicTitle: ["Song B"],
                publishedAt: [null],
                closedAt: [null],
                difficulty: {
                    "0": { playLevel: 18 },
                    "1": { playLevel: 20 },
                    "2": { playLevel: 22 },
                    "3": { playLevel: 24 },
                    "4": { playLevel: 26 },
                },
            },
        };

        expect(parser.buildSongLevelMap(payload)).toEqual({
            "1": [27, 23, 27, 30, 23],
            "2": [18, 20, 22, 24, 26],
        });
    });

    it("omits special when difficulty 4 is missing", () => {
        const parser = new BestdoriSongLevelParser();
        const payload: MusicDataResponse = {
            "3": {
                tag: Tag.TieUp,
                bandId: 3,
                jacketImage: [],
                musicTitle: ["Song C"],
                publishedAt: [null],
                closedAt: [null],
                difficulty: {
                    "0": { playLevel: 21 },
                    "1": { playLevel: 23 },
                    "2": { playLevel: 25 },
                    "3": { playLevel: 27 },
                },
            },
        };

        expect(parser.buildSongLevelMap(payload)).toEqual({
            "3": [21, 23, 25, 27],
        });
    });
});
