import type { MusicDataResponse } from "@/types/bestdori/songs";

export class BestdoriSongLevelParser {
    public buildSongLevelMap(payload: MusicDataResponse): Record<string, number[]> {
        const result: Record<string, number[]> = {};

        for (const [songId, music] of Object.entries(payload)) {
            const levels = [
                music.difficulty["0"].playLevel,
                music.difficulty["1"].playLevel,
                music.difficulty["2"].playLevel,
                music.difficulty["3"].playLevel,
            ];

            const special = music.difficulty["4"];
            if (special) {
                levels.push(special.playLevel);
            }

            result[songId] = levels;
        }

        return result;
    }
}
