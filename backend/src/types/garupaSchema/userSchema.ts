import type { SchemaDefinition } from "@/types/garupaSchema/schemaDefinition";

export const userDeckSchema: SchemaDefinition = {
    1: { name: "deckId", type: "int" },
    2: { name: "deckName", type: "string" },
    3: { name: "leader", type: "int" },
    4: { name: "member1", type: "int" },
    5: { name: "member2", type: "int" },
    6: { name: "member3", type: "int" },
    7: { name: "member4", type: "int" },
    8: { name: "bondsEffectIds", type: "int", repeated: true }, // uint[] 数组
    10: { name: "deckType", type: "string" },
};

export const userAppendParameterSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" }, // ulong 使用 int 盲扫解析
    2: { name: "situationId", type: "int" },
    3: { name: "performance", type: "int" },
    4: { name: "technique", type: "int" },
    5: { name: "visual", type: "int" },
    6: { name: "characterPotentialPerformance", type: "int" },
    7: { name: "characterPotentialTechnique", type: "int" },
    8: { name: "characterPotentialVisual", type: "int" },
    9: { name: "characterBonusPerformance", type: "int" },
    10: { name: "characterBonusTechnique", type: "int" },
    11: { name: "characterBonusVisual", type: "int" },
};

export const userSituationSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" },
    2: { name: "situationId", type: "int" },
    3: { name: "level", type: "int" },
    4: { name: "exp", type: "int" },
    5: { name: "createdAt", type: "int" },
    6: { name: "addExp", type: "int" },
    7: { name: "trainingStatus", type: "string" },
    8: { name: "duplicateCount", type: "int" },
    9: { name: "illust", type: "string" },
    10: { name: "skillExp", type: "int" },
    11: { name: "skillLevel", type: "int" },
    12: { name: "userAppendParameter", type: "message", schema: userAppendParameterSchema },
    13: { name: "limitBreakRank", type: "int" },
};

export const userSituationListSchema: SchemaDefinition = {
    1: { name: "entries", type: "message", repeated: true, schema: userSituationSchema },
};

export const userProfileSituationSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" },
    2: { name: "situationId", type: "int" },
    3: { name: "illust", type: "string" },
    4: { name: "viewProfileSituationStatus", type: "string" },
};

export const userProfileDegreeSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" },
    2: { name: "profileDegreeType", type: "string" },
    3: { name: "degreeId", type: "int" },
};

export const userProfileDegreeMapEntrySchema: SchemaDefinition = {
    1: { name: "key", type: "string" },
    2: { name: "value", type: "message", schema: userProfileDegreeSchema },
};

export const userProfileDegreeMapSchema: SchemaDefinition = {
    // 字典在二进制里表现为：反复出现的嵌套 K-V Message (repeated map entry)
    1: { name: "entries", type: "message", repeated: true, schema: userProfileDegreeMapEntrySchema },
};

// ==========================================
//  核心用户与列表层 Schema
// ==========================================

export const rankingUserSchema: SchemaDefinition = {
    1: { name: "name", type: "string" },
    2: { name: "ownFlg", type: "bool" },
    3: { name: "rankLevel", type: "int" },
    4: { name: "introduction", type: "string" },
    5: { name: "rank", type: "int" },
    6: { name: "point", type: "int" },
    7: { name: "userId", type: "int" },
    8: { name: "degreeId", type: "int" },
    9: { name: "userDeck", type: "message", schema: userDeckSchema },
    10: { name: "userSituationList", type: "message", schema: userSituationListSchema },
    11: { name: "userProfileSituation", type: "message", schema: userProfileSituationSchema },
    12: { name: "userProfileDegreeMap", type: "message", schema: userProfileDegreeMapSchema },
};

export const rankingUserListSchema: SchemaDefinition = {
    1: { name: "entries", type: "message", repeated: true, schema: rankingUserSchema },
};

// ==========================================================================================

export interface GarupaUserDeck {
    deckId?: number;
    deckName?: string;
    leader?: number;
    member1?: number;
    member2?: number;
    member3?: number;
    member4?: number;
    bondsEffectIds?: number[];
    deckType?: string;
}

export interface GarupaUserAppendParameter {
    userId?: number;
    situationId?: number;
    performance?: number;
    technique?: number;
    visual?: number;
    characterPotentialPerformance?: number;
    characterPotentialTechnique?: number;
    characterPotentialVisual?: number;
    characterBonusPerformance?: number;
    characterBonusTechnique?: number;
    characterBonusVisual?: number;
}

export interface GarupaUserSituation {
    userId?: number;
    situationId?: number;
    level?: number;
    exp?: number;
    createdAt?: number;
    addExp?: number;
    trainingStatus?: string;
    duplicateCount?: number;
    illust?: string;
    skillExp?: number;
    skillLevel?: number;
    userAppendParameter?: GarupaUserAppendParameter;
    limitBreakRank?: number;
}

export interface GarupaUserSituationList {
    entries?: GarupaUserSituation[];
}

export interface GarupaUserProfileSituation {
    userId?: number;
    situationId?: number;
    illust?: string;
    viewProfileSituationStatus?: string;
}

export interface GarupaUserProfileDegree {
    userId?: number;
    profileDegreeType?: string;
    degreeId?: number;
}

export interface GarupaUserProfileDegreeMapEntry {
    key?: string;
    value?: GarupaUserProfileDegree;
}

export interface GarupaUserProfileDegreeMap {
    entries?: GarupaUserProfileDegreeMapEntry[];
}

export interface GarupaRankingUser {
    name?: string;
    ownFlg?: boolean;
    rankLevel?: number;
    introduction?: string;
    rank?: number;
    point?: number;
    userId?: number;
    degreeId?: number;
    userDeck?: GarupaUserDeck;
    userSituationList?: GarupaUserSituationList;
    userProfileSituation?: GarupaUserProfileSituation;
    userProfileDegreeMap?: GarupaUserProfileDegreeMap;
}

export interface GarupaRankingUserList {
    entries?: GarupaRankingUser[];
}
