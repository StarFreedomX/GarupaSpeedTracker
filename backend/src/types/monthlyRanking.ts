export interface MonthlyRankingPlayer {
    uid: number;
    name: string;
    introduction: string;
    rank: number;
    sid: number;
    strained: number;
    degrees: number[];
    // tier: number; 玩家信息无需存储tier，因为会变，所以只需要在points同一时间里是1~10排序顺序就能确定那一时刻的名次了
    // 另外，玩家信息以最新为准
}

///==================Garupa源数据结构========================
// 从 Bandori 服务器获取并转化的 user 信息
export interface MonthlyRankingTopUserRaw extends MonthlyRankingPlayer {
    tier: number;
    point: number;
    // 还有一些字段我们抛弃了
}

// 从 Bandori 服务器获取并转化的原始结构
export interface MonthlyRankingBandoriRaw {
    monthlyRankingPointTopUsers: MonthlyRankingTopUserRaw[];
    monthlyRankingPointBorderUsers: MonthlyRankingTopUserRaw[];
}

export type MonthlyRankingInfo = {
    monthlyRankingName: Array<string | null>;
    assetBundleName: string;
    bgmFileName: string;
    startAt: Array<number | null>;
    endAt: Array<number | null>;
};
///===============================================

///===============服务器对外API=====================
// Top 接口
export interface MonthlyRankingTopPoint {
    timestamp: number;
    uid: number;
    value: number;
}

export interface MonthlyRankingTopResponse {
    points: MonthlyRankingTopPoint[];
    users: MonthlyRankingPlayer[];
}

export interface MonthlyRankingBorderPoint {
    time: number;
    ep: number;
}

export interface MonthlyRankingBorderResponse {
    result: boolean;
    cutoffs: MonthlyRankingBorderPoint[];
}

export interface MonthlyRankingInfoList {
    [monthlyRankingId: string]: MonthlyRankingInfo;
}
///=========================================

///================数据库====================
// 存储层使用的 snapshot 记录，字段与对外 API 保持一致，避免二次转换
export interface MonthlyRankingTopDocument extends MonthlyRankingTopResponse {
    server: number;
    monthlyId: number;
    updatedAt: number;
    bucket?: number;
}

export interface MonthlyRankingBorderDocument extends MonthlyRankingBorderResponse {
    server: number;
    monthlyId: number;
    tier: MonthlyRankingBorderTier;
    updatedAt: number;
}
///=========================================

export type MonthlyRankingBorderTier = 20 | 30 | 40 | 50 | 100 | 200 | 300 | 500 | 1000 | 2000 | 3000 | 4000 | 5000;

export interface MonthlyRankingInfoDocument extends MonthlyRankingInfo {
    monthlyRankingId: number;
    updatedAt: number;
}
