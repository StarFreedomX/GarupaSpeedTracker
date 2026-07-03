import { type GarupaRankingUserList, rankingUserListSchema } from "@/types/garupaSchema/rankingUserSchema"; // 假设你保存在这里
import type { SchemaDefinition } from "./schemaDefinition";
// ==========================================
//  顶层根响应 Schema
// ==========================================
export const userMedleyEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "eventPointNearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "eventPointTopUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "scoreNearUsers", type: "message", schema: rankingUserListSchema },
    4: { name: "scoreTopUsers", type: "message", schema: rankingUserListSchema },
    5: { name: "eventPointBorderUsers", type: "message", schema: rankingUserListSchema },
    6: { name: "scoreBorderUsers", type: "message", schema: rankingUserListSchema },
};

export const userLiveTryEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "nearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "topUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "eventPointBorderUsers", type: "message", schema: rankingUserListSchema },
};

export const userStoryEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "nearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "topUsers", type: "message", schema: rankingUserListSchema },
};

export const userChallengeMusicRankingResponseSchema: SchemaDefinition = {
    1: { name: "musicId", type: "int" },
    2: { name: "scoreNearUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "scoreTopUsers", type: "message", schema: rankingUserListSchema },
    4: { name: "scoreBorderUsers", type: "message", schema: rankingUserListSchema },
};

export const userChallengeEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "eventPointNearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "eventPointTopUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "eventPointBorderUsers", type: "message", schema: rankingUserListSchema },
    4: { name: "challengeMusicRankings", type: "message", repeated: true, schema: userChallengeMusicRankingResponseSchema },
};

export const userMissionLiveEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "nearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "topUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "borderUsers", type: "message", schema: rankingUserListSchema },
};

export const userTeamLiveFestivalEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "nearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "topUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "eventPointBorderUsers", type: "message", schema: rankingUserListSchema },
};

export const userVersusMusicRankingResponseSchema: SchemaDefinition = {
    1: { name: "musicId", type: "int" },
    2: { name: "scoreNearUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "scoreTopUsers", type: "message", schema: rankingUserListSchema },
    4: { name: "scoreBorderUsers", type: "message", schema: rankingUserListSchema },
};

export const userVersusEventRankingResponseSchema: SchemaDefinition = {
    1: { name: "eventPointNearUsers", type: "message", schema: rankingUserListSchema },
    2: { name: "eventPointTopUsers", type: "message", schema: rankingUserListSchema },
    3: { name: "versusMusicRankings", type: "message", repeated: true, schema: userVersusMusicRankingResponseSchema },
    4: { name: "eventPointBorderUsers", type: "message", schema: rankingUserListSchema },
};

export interface GarupaMedleyEventRankingResponse {
    eventPointNearUsers?: GarupaRankingUserList;
    eventPointTopUsers?: GarupaRankingUserList;
    scoreNearUsers?: GarupaRankingUserList;
    scoreTopUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
    scoreBorderUsers?: GarupaRankingUserList;
}

export interface GarupaLiveTryEventRankingResponse {
    nearUsers?: GarupaRankingUserList;
    topUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
}

export interface GarupaStoryEventRankingResponse {
    nearUsers: GarupaRankingUserList;
    topUsers?: GarupaRankingUserList;
}

export interface GarupaChallengeMusicRankingResponse {
    musicId: number;
    scoreNearUsers?: GarupaRankingUserList;
    scoreTopUsers?: GarupaRankingUserList;
    scoreBorderUsers?: GarupaRankingUserList;
}
export interface GarupaChallengeEventRankingResponse {
    eventPointNearUsers?: GarupaRankingUserList;
    eventPointTopUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
    challengeMusicRankings?: GarupaChallengeMusicRankingResponse[];
}
export interface GarupaMissionLiveEventRankingResponse {
    nearUsers?: GarupaRankingUserList;
    topUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
}
export interface GarupaTeamLiveFestivalEventRankingResponse {
    nearUsers?: GarupaRankingUserList;
    topUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
}
export interface GarupaVersusMusicRankingResponse {
    musicId: number;
    scoreNearUsers?: GarupaRankingUserList;
    scoreTopUsers?: GarupaRankingUserList;
    scoreBorderUsers?: GarupaRankingUserList;
}
export interface GarupaVersusEventRankingResponse {
    eventPointNearUsers?: GarupaRankingUserList;
    eventPointTopUsers?: GarupaRankingUserList;
    eventPointBorderUsers?: GarupaRankingUserList;
    versusMusicRankings?: GarupaVersusMusicRankingResponse[];
}
