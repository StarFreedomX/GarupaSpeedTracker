import { buildUsers, garupaParser } from "@/parsers/GarupaRankingParser";
import type { EventRankingBandoriRaw, MusicRankingBandoriRaw } from "@/types/event";
import type {
    GarupaChallengeEventRankingResponse,
    GarupaChallengeMusicRankingResponse,
    GarupaLiveTryEventRankingResponse,
    GarupaMedleyEventRankingResponse,
    GarupaMissionLiveEventRankingResponse,
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
    medleyMusicRanking: {
        musicId: 1,
        scoreTopUsers: buildUsers(data.scoreTopUsers),
        scoreBorderUsers: buildUsers(data.scoreBorderUsers),
    },
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

/**
 * Parses Garupa event ranking protobuf responses for all 7 supported event types.
 *
 * **Supported event types:** medley, challenge, versus, live_try, story, mission_live, team_live_festival.
 *
 * The parser selects the appropriate protobuf schema and report builder based on the
 * `eventType` string. Each event type has a dedicated schema (protobuf message descriptor)
 * and a `buildReport` function that maps decoded protobuf fields into a unified
 * {@link EventRankingBandoriRaw} structure.
 *
 * The `challenge` and `versus` event types additionally parse per-song music ranking sub-lists.
 */
export class GarupaEventRankingParser {
    /**
     * Parses a decrypted event ranking response buffer into a unified ranking report.
     * @param payload - Decrypted protobuf response from the Garupa API
     * @param eventType - Protobuf event type string (one of the 7 supported types)
     * @returns Parsed and normalized event ranking data
     * @throws If the event type is not found in {@link SCHEMA_MAP} or the report builder
     */
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

/** Singleton instance of {@link GarupaEventRankingParser} used by the Garupa API client. */
export const bandoriEventRankingParser = new GarupaEventRankingParser();
