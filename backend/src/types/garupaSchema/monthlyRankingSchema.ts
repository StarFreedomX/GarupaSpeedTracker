import type { SchemaDefinition } from "./schemaDefinition"; // 假设你保存在这里

// ==========================================
//  基础依赖项与子结构 Schema
// ==========================================

const userDeckSchema: SchemaDefinition = {
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

const userAppendParameterSchema: SchemaDefinition = {
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

const userSituationSchema: SchemaDefinition = {
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

const userSituationListSchema: SchemaDefinition = {
    1: { name: "entries", type: "message", repeated: true, schema: userSituationSchema },
};

const userProfileSituationSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" },
    2: { name: "situationId", type: "int" },
    3: { name: "illust", type: "string" },
    4: { name: "viewProfileSituationStatus", type: "string" },
};

const userProfileDegreeSchema: SchemaDefinition = {
    1: { name: "userId", type: "int" },
    2: { name: "profileDegreeType", type: "string" },
    3: { name: "degreeId", type: "int" },
};

const userProfileDegreeMapEntrySchema: SchemaDefinition = {
    1: { name: "key", type: "string" },
    2: { name: "value", type: "message", schema: userProfileDegreeSchema },
};

const userProfileDegreeMapSchema: SchemaDefinition = {
    // 字典在二进制里表现为：反复出现的嵌套 K-V Message (repeated map entry)
    1: { name: "entries", type: "message", repeated: true, schema: userProfileDegreeMapEntrySchema },
};

// ==========================================
//  核心用户与列表层 Schema
// ==========================================

const rankingUserSchema: SchemaDefinition = {
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

const rankingUserListSchema: SchemaDefinition = {
    1: { name: "entries", type: "message", repeated: true, schema: rankingUserSchema },
};

// ==========================================
//  顶层根响应 Schema
// ==========================================
export const userMonthlyRankingRankingResponseSchema: SchemaDefinition = {
    1: { name: "monthlyRankingPointNearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "monthlyRankingPointTopUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "monthlyRankingPointBorderUsers", type: "message", schema: rankingUserListSchema },
};

// 排行榜奖励
export const masterMonthlyRankingRewardSchema: SchemaDefinition = {
    1: { name: "id", type: "int" },
    2: { name: "monthlyRankingId", type: "int" },
    3: { name: "fromRank", type: "int" },
    4: { name: "toRank", type: "int" },
    5: { name: "rewardType", type: "string" },
    6: { name: "rewardId", type: "int" },
    7: { name: "rewardQuantity", type: "int" },
};

export const masterMonthlyRankingGradeSchema: SchemaDefinition = {
    1: { name: "id", type: "int" },
    2: { name: "monthlyRankingId", type: "int" },
    3: { name: "gradeAheadType", type: "string" },
    4: { name: "pt", type: "int" },
    5: { name: "rewardType", type: "string" },
    6: { name: "rewardId", type: "int" },
    7: { name: "rewardQuantity", type: "int" },
    8: { name: "rankingThresholdFlg", type: "bool" },
};

// 月榜信息字段
export const masterMonthlyRankingSchema: SchemaDefinition = {
    1: { name: "monthlyRankingId", type: "int" },
    2: { name: "monthlyRankingName", type: "string" },
    3: { name: "assetBundleName", type: "string" },
    4: { name: "bgmAssetBundleName", type: "string" },
    5: { name: "bgmFileName", type: "string" },
    6: { name: "startAt", type: "int" },
    7: { name: "endAt", type: "int" },
    8: { name: "enableFlg", type: "bool" },
    9: { name: "publicStartAt", type: "int" },
    10: { name: "publicEndAt", type: "int" },
    11: { name: "distributionStartAt", type: "int" },
    12: { name: "distributionEndAt", type: "int" },
    13: { name: "receptionEndAt", type: "int" },
    14: { name: "aggregateEndAt", type: "int" },

    101: {
        name: "rewards",
        type: "message",
        repeated: true,
        schema: masterMonthlyRankingRewardSchema,
    },
    102: {
        name: "grades",
        type: "message",
        repeated: true,
        schema: masterMonthlyRankingGradeSchema,
    },
};

// 月榜列表接口返回结构，包含多个月榜的基本信息（不包含玩家信息）
export const masterMonthlyRankingListSchema: SchemaDefinition = {
    1: {
        name: "entries",
        type: "message",
        repeated: true,
        schema: masterMonthlyRankingSchema,
    },
};

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

export interface GarupaMonthlyRankingRankingResponse {
    monthlyRankingPointNearUsers?: GarupaRankingUserList;
    monthlyRankingPointTopUsers?: GarupaRankingUserList;
    monthlyRankingPointBorderUsers?: GarupaRankingUserList;
}

export interface GarupaMasterMonthlyRankingReward {
    id?: number;
    monthlyRankingId?: number;
    fromRank?: number;
    toRank?: number;
    rewardType?: string;
    rewardId?: number;
    rewardQuantity?: number;
}

export interface GarupaMasterMonthlyRankingGrade {
    id?: number;
    monthlyRankingId?: number;
    gradeAheadType?: string;
    pt?: number;
    rewardType?: string;
    rewardId?: number;
    rewardQuantity?: number;
    rankingThresholdFlg?: boolean;
}

export interface GarupaMasterMonthlyRanking {
    monthlyRankingId?: number;
    monthlyRankingName?: string;
    assetBundleName?: string;
    bgmAssetBundleName?: string;
    bgmFileName?: string;
    startAt?: number;
    endAt?: number;
    enableFlg?: boolean;
    publicStartAt?: number;
    publicEndAt?: number;
    distributionStartAt?: number;
    distributionEndAt?: number;
    receptionEndAt?: number;
    aggregateEndAt?: number;
    rewards?: GarupaMasterMonthlyRankingReward[];
    grades?: GarupaMasterMonthlyRankingGrade[];
}

export interface GarupaMasterMonthlyRankingListResponse {
    entries?: GarupaMasterMonthlyRanking[];
}
