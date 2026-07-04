import type { GarupaMasterEventPointReward, GarupaMasterEventRankingReward } from "@/types/garupaSchema/eventSchema";
import type { RankingUser, RankingUserRaw } from "@/types/rankingUser";

///==================统一Garupa源数据结构========================
export interface EventRankingBandoriRaw {
    eventPointTopUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
    musicRankings?: MusicRankingBandoriRaw[];
}

export interface MusicRankingBandoriRaw {
    musicId: number;
    scoreTopUsers?: RankingUserRaw[];
    scoreBorderUsers?: RankingUserRaw[];
}
///==================Garupa源数据结构========================
/*
// 从 Bandori 服务器获取并转化的原始结构
export interface MedleyEventRankingBandoriRaw {
    // eventPointNearUsers?: RankingUserRaw[];
    eventPointTopUsers?: RankingUserRaw[];
    // scoreNearUsers?: RankingUserRaw[];
    scoreTopUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
    scoreBorderUsers?: RankingUserRaw[];
}

export interface LiveTryEventRankingBandoriRaw {
    // nearUsers?: RankingUserRaw[];
    topUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
}

export interface StoryEventRankingBandoriRaw {
    // nearUsers: RankingUserRaw[];
    topUsers?: RankingUserRaw[];
}

export interface ChallengeMusicRankingBandoriRaw {
    musicId: number;
    // scoreNearUsers?: RankingUserRaw[];
    scoreTopUsers?: RankingUserRaw[];
    scoreBorderUsers?: RankingUserRaw[];
}
export interface ChallengeEventRankingBandoriRaw {
    // eventPointNearUsers?: RankingUserRaw[];
    eventPointTopUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
    challengeMusicRankings?: ChallengeMusicRankingBandoriRaw[];
}
export interface MissionLiveEventRankingBandoriRaw {
    // nearUsers?: RankingUserRaw[];
    topUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
}
export interface TeamLiveFestivalEventRankingBandoriRaw {
    // nearUsers?: RankingUserRaw[];
    topUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
}
export interface VersusMusicRankingBandoriRaw {
    musicId: number;
    // scoreNearUsers?: RankingUserRaw[];
    scoreTopUsers?: RankingUserRaw[];
    scoreBorderUsers?: RankingUserRaw[];
}
export interface VersusEventRankingBandoriRaw {
    // eventPointNearUsers?: RankingUserRaw[];
    eventPointTopUsers?: RankingUserRaw[];
    eventPointBorderUsers?: RankingUserRaw[];
    versusMusicRankings?: VersusMusicRankingBandoriRaw[];
}*/

export type EventInfo = {
    eventType: string;
    eventName: Array<string | null>;
    assetBundleName: string;
    bgmFileName: string;
    startAt: Array<number | null>;
    endAt: Array<number | null>;
};
export interface EventDetail extends EventInfo {
    eventId: number;
    enableFlag: Array<boolean | null>;
    publicStartAt: Array<number | null>;
    publicEndAt: Array<number | null>;
    distributionStartAt: Array<number | null>;
    distributionEndAt: Array<number | null>;
    aggregateEndAt: Array<number | null>;
    receptionEndAt: Array<number | null>;
    pointRewards?: Array<GarupaMasterEventPointReward[] | null>;
    rankingRewards?: Array<GarupaMasterEventRankingReward[] | null>;
}
///===============================================

///===============服务器对外API=====================
// Event Top 接口
export interface EventRankingTopResponse {
    points: EventRankingTopPoint[];
    users: RankingUser[];
}
export interface EventRankingTopPoint {
    timestamp: number;
    uid: number;
    value: number;
}

// Event Border接口
export interface EventRankingBorderResponse {
    result: boolean;
    cutoffs: EventRankingBorderPoint[];
}
export interface EventRankingBorderPoint {
    time: number;
    ep: number;
}

// Music Top 接口
export interface MusicRankingTopResponse {
    points: MusicRankingTopPoint[];
    users: RankingUser[];
}
export interface MusicRankingTopPoint {
    timestamp: number;
    uid: number;
    value: number;
}

// Music Border接口
export interface MusicRankingBorderResponse {
    result: boolean;
    cutoffs: MusicRankingBorderPoint[];
}
export interface MusicRankingBorderPoint {
    time: number;
    ep: number;
}

// Info接口
export interface EventInfoList {
    [eventId: string]: EventInfo;
}

// Detail接口
export interface EventDetailList {
    [eventId: string]: EventDetail;
}

///=========================================

///================数据库====================
// 存储层使用的 snapshot 记录
// 玩家信息已拆分到 RankingPlayerDocument 独立存储
export interface EventRankingTopDocument {
    points: EventRankingTopPoint[];
    server: number;
    eventId: number;
    updatedAt: number;
    bucket?: number;
}
export interface EventRankingBorderDocument extends EventRankingBorderResponse {
    server: number;
    eventId: number;
    tier: EventRankingBorderTier;
    updatedAt: number;
}

export interface MusicRankingTopDocument {
    points: MusicRankingTopPoint[];
    server: number;
    eventId: number;
    musicId: number;
    updatedAt: number;
    bucket?: number;
}

export interface MusicRankingBorderDocument extends MusicRankingBorderResponse {
    server: number;
    eventId: number;
    musicId: number;
    tier: MusicRankingBorderTier;
    updatedAt: number;
}
///=========================================

export type EventRankingBorderTier =
    | 20
    | 30
    | 40
    | 50
    | 100
    | 200
    | 300
    | 500
    | 1000
    | 2000
    | 3000
    | 4000
    | 5000
    | 10000
    | 20000
    | 30000
    | 40000
    | 50000
    | 100000;
export type MusicRankingBorderTier = 20 | 30 | 40 | 50 | 100 | 200 | 300 | 500 | 1000 | 2000 | 5000 | 10000 | 20000 | 50000 | 100000;

export interface EventDetailDocument extends EventDetail {
    updatedAt: number;
}

export interface EventInfoDocument extends EventDetailDocument {
    eventId: number;
}
