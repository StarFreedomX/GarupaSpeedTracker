import { GarupaParser } from "@/parsers/GarupaParser";
import { type DifficultyKey, type MusicDataResponse, type MusicItem, Tag } from "@/types/bestdori/songs";
import { type SuiteMusic, suiteMusicSchema } from "@/types/garupaSchema/musicSchema";

const difficultyKeys: Record<string, DifficultyKey> = { easy: "0", normal: "1", hard: "2", expert: "3", special: "4" };
const regionValue = (value?: number): (string | null)[] => [value === undefined ? null : String(value), null, null, null, null];
const isLevel = (value: number | undefined): value is number => Number.isInteger(value) && Number(value) > 0;

// Temporary compatibility fix: JP master currently exposes special song titles with internal prefixes.
const normalizeMusicTitle = (title: string): string => title.replace(/^甅/, "[FULL]").replace(/^躄/, "[原曲]");

/** Converts the JP masters into the existing public song format. */
export function parseGarupaMusic(payload: Buffer): MusicDataResponse {
    const suite = new GarupaParser().decode<SuiteMusic>(payload, suiteMusicSchema);
    const musicEntries = suite.musicList?.entries;
    const difficultyEntries = suite.difficultyList?.entries;
    if (!musicEntries?.length || !difficultyEntries?.length) throw new Error("JP music master is empty or invalid");

    const difficulties = new Map<number, Partial<MusicItem["difficulty"]>>();
    for (const entry of difficultyEntries) {
        const key = difficultyKeys[entry.difficulty];
        if (!key) continue;
        if (!isLevel(entry.playLevel)) throw new Error(`Invalid JP playLevel: song=${entry.musicId} difficulty=${entry.difficulty}`);
        if (entry.scoreLevel !== undefined && entry.scoreLevel !== 0 && !isLevel(entry.scoreLevel)) {
            throw new Error(`Invalid JP scoreLevel: song=${entry.musicId} difficulty=${entry.difficulty}`);
        }
        const songDifficulties = difficulties.get(entry.musicId) ?? {};
        songDifficulties[key] = {
            playLevel: entry.playLevel,
            // Older/unchanged charts may omit scoreLevel (protobuf uint32 default 0).
            scoreLevel: isLevel(entry.scoreLevel) ? entry.scoreLevel : entry.playLevel,
            publishedAt: regionValue(entry.publishedAt),
        };
        difficulties.set(entry.musicId, songDifficulties);
    }

    const result: MusicDataResponse = {};
    for (const entry of musicEntries) {
        if (!Number.isInteger(entry.musicId) || entry.musicId <= 0 || typeof entry.musicTitle !== "string") {
            throw new Error("Invalid JP music identity");
        }
        const difficulty = difficulties.get(entry.musicId);
        if (!difficulty?.["0"] || !difficulty["1"] || !difficulty["2"] || !difficulty["3"]) {
            throw new Error(`Incomplete JP difficulties: song=${entry.musicId}`);
        }
        result[String(entry.musicId)] = {
            tag: (entry.tag ?? Tag.Normal) as Tag,
            bandId: entry.bandId,
            jacketImage: entry.jacketImage === undefined ? [] : [entry.jacketImage],
            musicTitle: [normalizeMusicTitle(entry.musicTitle), null, null, null, null],
            publishedAt: regionValue(entry.publishedAt),
            closedAt: regionValue(entry.closedAt),
            difficulty: difficulty as MusicItem["difficulty"],
        };
    }
    return result;
}
