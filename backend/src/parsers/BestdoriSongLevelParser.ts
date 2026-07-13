import type { MusicDataResponse } from "@/types/bestdori/songs";

/**
 * Parses Bestdori song/music data to extract per-song difficulty levels.
 *
 * The raw payload is keyed by song ID. For each song, the parser reads level values
 * from difficulties 0–3 (Easy, Normal, Hard, Expert) plus optionally difficulty 4 (Special)
 * if present.
 */
export class BestdoriSongLevelParser {
    /**
     * Builds a map of song ID → array of difficulty levels from the Bestdori music data.
     *
     * Each array contains level values for difficulties 0–3, plus difficulty 4 (Special)
     * when that difficulty exists for the song.
     *
     * @param payload - Raw Bestdori music data (songs/all.5.json)
     * @returns A record mapping song ID strings to arrays of level numbers
     */
    public buildSongLevelMap(payload: MusicDataResponse): Record<string, number[]> {
        const result: Record<string, number[]> = {};

        for (const [songId, music] of Object.entries(payload)) {
            const levels = [music.difficulty["0"].playLevel, music.difficulty["1"].playLevel, music.difficulty["2"].playLevel, music.difficulty["3"].playLevel];

            const special = music.difficulty["4"];
            if (special) {
                levels.push(special.playLevel);
            }

            result[songId] = levels;
        }

        return result;
    }
}
