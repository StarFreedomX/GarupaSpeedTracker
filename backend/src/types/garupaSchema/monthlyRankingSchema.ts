import type { SchemaDefinition } from "./schemaDefinition";

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
