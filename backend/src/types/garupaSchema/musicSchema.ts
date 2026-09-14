import type { SchemaDefinition } from "./schemaDefinition";

// MasterMusicGetResponse / MasterMusicDifficultyGetResponse (JP client protocol).
export const masterMusicSchema: SchemaDefinition = {
    1: { name: "musicId", type: "int" },
    2: { name: "musicTitle", type: "string" },
    7: { name: "tag", type: "string" },
    11: { name: "bandId", type: "int" },
    14: { name: "jacketImage", type: "string" },
    16: { name: "publishedAt", type: "long" },
    17: { name: "closedAt", type: "long" },
};

export const masterMusicDifficultySchema: SchemaDefinition = {
    1: { name: "musicId", type: "int" },
    2: { name: "difficulty", type: "string" },
    3: { name: "playLevel", type: "int" },
    5: { name: "notesQuantity", type: "int" },
    11: { name: "publishedAt", type: "long" },
    13: { name: "scoreLevel", type: "int" },
};

export const suiteMusicSchema: SchemaDefinition = {
    1: { name: "musicList", type: "message", schema: { 1: { name: "entries", type: "message", repeated: true, schema: masterMusicSchema } } },
    2: { name: "difficultyList", type: "message", schema: { 1: { name: "entries", type: "message", repeated: true, schema: masterMusicDifficultySchema } } },
};

export interface GarupaMusic {
    musicId: number;
    musicTitle: string;
    tag?: string;
    bandId: number;
    jacketImage?: string;
    publishedAt?: number;
    closedAt?: number;
}

export interface GarupaMusicDifficulty {
    musicId: number;
    difficulty: string;
    playLevel: number;
    notesQuantity?: number;
    publishedAt?: number;
    scoreLevel?: number;
}

export interface SuiteMusic {
    musicList?: { entries?: GarupaMusic[] };
    difficultyList?: { entries?: GarupaMusicDifficulty[] };
}
