import { GarupaParser } from "@/parsers/GarupaParser";
import type { EventRankingBandoriRaw, MusicRankingBandoriRaw } from "@/types/event";
import type {
    GarupaChallengeEventRankingResponse,
    GarupaChallengeMusicRankingResponse,
    GarupaLiveTryEventRankingResponse,
    GarupaMedleyEventRankingResponse,
    GarupaMissionLiveEventRankingResponse,
    GarupaRankingUser,
    GarupaStoryEventRankingResponse,
    GarupaTeamLiveFestivalEventRankingResponse,
    GarupaVersusEventRankingResponse,
    GarupaVersusMusicRankingResponse,
} from "@/types/garupaSchema";
import {
    userChallengeEventRankingResponseSchema,
    userLiveTryEventRankingResponseSchema,
    userMedleyEventRankingResponseSchema,
    userMissionLiveEventRankingResponseSchema,
    userStoryEventRankingResponseSchema,
    userTeamLiveFestivalEventRankingResponseSchema,
    userVersusEventRankingResponseSchema,
} from "@/types/garupaSchema";
import type { SchemaDefinition } from "@/types/garupaSchema/schemaDefinition";
import type { RankingUserRaw } from "@/types/rankingUser";

const garupaParser = new GarupaParser();

// ============================================================================
// Shared user parsing (same logic as GarupaMonthlyRankingParser)
// ============================================================================

const toNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const buildDegrees = (user: GarupaRankingUser): number[] => {
    const entries = user.userProfileDegreeMap?.entries ?? [];
    return entries.map((entry) => toNumber(entry.value?.degreeId)).filter((value) => Number.isFinite(value));
};

const parseUser = (user: GarupaRankingUser): RankingUserRaw => {
    const profileSituation = user.userProfileSituation;
    const strained = profileSituation?.illust === "after_training" ? 1 : 0;

    return {
        uid: toNumber(user.userId),
        name: user.name ?? "",
        introduction: user.introduction ?? "",
        rank: toNumber(user.rankLevel),
        sid: toNumber(profileSituation?.situationId),
        strained,
        degrees: buildDegrees(user),
        tier: toNumber(user.rank),
        point: toNumber(user.point),
    };
};

const buildUsers = (container?: { entries?: GarupaRankingUser[] }): RankingUserRaw[] => {
    const rows = container?.entries ?? [];
    return rows.map((user) => parseUser(user));
};

// ============================================================================
// Event type → Schema mapping
// ============================================================================

interface SchemaEntry {
    schema: SchemaDefinition;
}

const SCHEMA_MAP: Record<string, SchemaEntry> = {
    medley: { schema: userMedleyEventRankingResponseSchema },
    challenge: { schema: userChallengeEventRankingResponseSchema },
    versus: { schema: userVersusEventRankingResponseSchema },
    live_try: { schema: userLiveTryEventRankingResponseSchema },
    story: { schema: userStoryEventRankingResponseSchema },
    mission_live: { schema: userMissionLiveEventRankingResponseSchema },
    team_live_festival: { schema: userTeamLiveFestivalEventRankingResponseSchema },
};

const SUPPORTED_TYPES = Object.keys(SCHEMA_MAP);

// ============================================================================
// Build unified report per event type
// ============================================================================

const buildMusicRankingFromChallenge = (entry: GarupaChallengeMusicRankingResponse): MusicRankingBandoriRaw => ({
    musicId: typeof entry.musicId === "number" ? entry.musicId : 0,
    scoreTopUsers: buildUsers(entry.scoreTopUsers),
    scoreBorderUsers: buildUsers(entry.scoreBorderUsers),
});

const buildMusicRankingFromVersus = (entry: GarupaVersusMusicRankingResponse): MusicRankingBandoriRaw => ({
    musicId: typeof entry.musicId === "number" ? entry.musicId : 0,
    scoreTopUsers: buildUsers(entry.scoreTopUsers),
    scoreBorderUsers: buildUsers(entry.scoreBorderUsers),
});

const buildMedleyReport = (data: GarupaMedleyEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.eventPointTopUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
});

const buildChallengeReport = (data: GarupaChallengeEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.eventPointTopUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
    musicRankings: (data.challengeMusicRankings ?? []).map(buildMusicRankingFromChallenge),
});

const buildVersusReport = (data: GarupaVersusEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.eventPointTopUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
    musicRankings: (data.versusMusicRankings ?? []).map(buildMusicRankingFromVersus),
});

const buildLiveTryReport = (data: GarupaLiveTryEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.topUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
});

const buildStoryReport = (data: GarupaStoryEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.topUsers),
});

const buildMissionLiveReport = (data: GarupaMissionLiveEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.topUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
});

const buildTeamLiveFestivalReport = (data: GarupaTeamLiveFestivalEventRankingResponse): EventRankingBandoriRaw => ({
    eventPointTopUsers: buildUsers(data.topUsers),
    eventPointBorderUsers: buildUsers(data.eventPointBorderUsers),
});

type ReportBuilder = (data: unknown) => EventRankingBandoriRaw;

const REPORT_BUILDERS: Record<string, ReportBuilder> = {
    medley: buildMedleyReport as ReportBuilder,
    challenge: buildChallengeReport as ReportBuilder,
    versus: buildVersusReport as ReportBuilder,
    live_try: buildLiveTryReport as ReportBuilder,
    story: buildStoryReport as ReportBuilder,
    mission_live: buildMissionLiveReport as ReportBuilder,
    team_live_festival: buildTeamLiveFestivalReport as ReportBuilder,
};

// ============================================================================
// Parser class
// ============================================================================

export class GarupaEventRankingParser {
    public parse(payload: Buffer, eventType: string): EventRankingBandoriRaw {
        const schemaEntry = SCHEMA_MAP[eventType];
        if (!schemaEntry) {
            throw new Error(`Unsupported event type: "${eventType}". Supported: ${SUPPORTED_TYPES.join(", ")}`);
        }

        const decoded = garupaParser.decode(payload, schemaEntry.schema);
        const builder = REPORT_BUILDERS[eventType];
        if (!builder) {
            throw new Error(`No report builder for event type: "${eventType}"`);
        }

        return builder(decoded);
    }
}

export const bandoriEventRankingParser = new GarupaEventRankingParser();
