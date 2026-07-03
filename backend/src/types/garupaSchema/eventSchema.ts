import type { SchemaDefinition } from "./schemaDefinition";

// 排行榜奖励
export const masterEventRankingRewardSchema: SchemaDefinition = {
    1: { name: "id", type: "int" },
    2: { name: "eventId", type: "int" },
    3: { name: "fromRank", type: "int" },
    4: { name: "toRank", type: "int" },
    5: { name: "rewardType", type: "string" },
    6: { name: "rewardId", type: "int" },
    7: { name: "rewardQuantity", type: "int" },
    8: { name: "recommendFlg", type: "bool" },
};

export const masterEventPointRewardSchema: SchemaDefinition = {
    1: { name: "id", type: "int" },
    2: { name: "eventId", type: "int" },
    3: { name: "point", type: "long" },
    4: { name: "rewardType", type: "string" },
    5: { name: "rewardId", type: "int" },
    6: { name: "rewardQuantity", type: "int" },
    7: { name: "recommendFlg", type: "bool" },
};

// 月榜信息字段
export const masterEventSchema: SchemaDefinition = {
    1: { name: "eventId", type: "int" },
    2: { name: "eventType", type: "string" },
    3: { name: "eventName", type: "string" },
    4: { name: "assetBundleName", type: "string" },
    5: { name: "startAt", type: "long" },
    6: { name: "endAt", type: "long" },
    7: { name: "enableFlg", type: "bool" },
    8: { name: "publicStartAt", type: "long" },
    9: { name: "publicEndAt", type: "long" },
    10: { name: "distributionStartAt", type: "long" },
    11: { name: "distributionEndAt", type: "long" },
    12: { name: "bgmAssetBundleName", type: "string" },
    13: { name: "bgmFileName", type: "string" },
    14: { name: "aggregateEndAt", type: "long" },
    15: { name: "eventExchangesEndAt", type: "long" },
    16: { name: "receptionEndAt", type: "long" },
    18: { name: "previousEventId", type: "int" },

    101: {
        name: "pointRewards",
        type: "message",
        repeated: true,
        schema: masterEventPointRewardSchema,
    },
    102: {
        name: "rankingRewards",
        type: "message",
        repeated: true,
        schema: masterEventRankingRewardSchema,
    },
};

// 活动列表接口返回结构，包含多个活动的基本信息（不包含玩家信息）
export const masterEventListSchema: SchemaDefinition = {
    1: {
        name: "entries",
        type: "message",
        repeated: true,
        schema: masterEventSchema,
    },
};

export interface GarupaMasterEventPointReward {
    id?: number;
    eventId?: number;
    fromRank?: number;
    toRank?: number;
    rewardType?: string;
    rewardId?: number;
    rewardQuantity?: number;
}

export interface GarupaMasterEventRankingReward {
    id?: number;
    eventId?: number;
    point?: number;
    rewardType?: string;
    rewardId?: number;
    rewardQuantity?: number;
    recommendFlg?: boolean;
}

export interface GarupaMasterEvent {
    eventId?: number;
    eventType?: string;
    eventName?: string;
    assetBundleName?: string;
    startAt?: number;
    endAt?: number;
    enableFlg?: boolean;
    publicStartAt?: number;
    publicEndAt?: number;
    distributionStartAt?: number;
    distributionEndAt?: number;
    bgmAssetBundleName?: string;
    bgmFileName?: string;
    aggregateEndAt?: number;
    eventExchangesEndAt?: number;
    receptionEndAt?: number;
    previousEventId?: number;

    pointRewards?: GarupaMasterEventPointReward[];
    rankingRewards?: GarupaMasterEventRankingReward[];
}

export interface GarupaMasterEventListResponse {
    entries?: GarupaMasterEvent[];
}
