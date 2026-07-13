import type { GarupaMasterMonthlyRankingGrade, GarupaMasterMonthlyRankingReward } from "@/types/garupaSchema";
import type { RankingUser, RankingUserRaw } from "@/types/rankingUser";

///==================Garupa源数据结构========================

// 从 Bandori 服务器获取并转化的原始结构
export interface MonthlyRankingBandoriRaw {
    monthlyRankingPointTopUsers: RankingUserRaw[];
    monthlyRankingPointBorderUsers: RankingUserRaw[];
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
    time: number;
    uid: number;
    value: number;
}

export interface MonthlyRankingTopResponse {
    points: MonthlyRankingTopPoint[];
    users: RankingUser[];
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

export interface MonthlyRankingDetailList {
    [monthlyRankingId: string]: MonthlyRankingDetail;
}

export interface MonthlyRankingDetail extends MonthlyRankingInfo {
    monthlyRankingId: number;
    enableFlag: Array<boolean | null>;
    publicStartAt: Array<number | null>;
    publicEndAt: Array<number | null>;
    distributionStartAt: Array<number | null>;
    distributionEndAt: Array<number | null>;
    aggregateEndAt: Array<number | null>;
    receptionEndAt: Array<number | null>;
    rewards?: Array<GarupaMasterMonthlyRankingReward[] | null>;
    grades?: Array<GarupaMasterMonthlyRankingGrade[] | null>;
}
///=========================================

///================数据库====================
// 存储层使用的 snapshot 记录
// 玩家信息已拆分到 MonthlyRankingPlayerDocument 独立存储
export interface MonthlyRankingTopDocument {
    points: MonthlyRankingTopPoint[];
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

export interface MonthlyRankingDetailDocument extends MonthlyRankingDetail {
    updatedAt: number;
}

// 兼容历史命名：info collection 现在实际存的是完整 detail 文档
export interface MonthlyRankingInfoDocument extends MonthlyRankingDetailDocument {
    monthlyRankingId: number;
}
