import { buildUsers, garupaParser } from "@/parsers/GarupaRankingParser";
import type { GarupaMonthlyRankingRankingResponse } from "@/types/garupaSchema";
import { userMonthlyRankingRankingResponseSchema } from "@/types/garupaSchema";
import type { MonthlyRankingBandoriRaw } from "@/types/monthlyRanking";

/**
 * Parses Garupa monthly ranking protobuf responses.
 *
 * Decodes the `UserMonthlyRankingRankingResponse` protobuf message and extracts
 * the top-rank and border-rank user lists. Each user is normalized into a
 * {@link RankingUserRaw} record with fields such as UID, name, rank, tier, points,
 * and card degrees.
 */
export class GarupaMonthlyRankingParser {
    /**
     * Parses a decrypted monthly ranking response buffer.
     * @param payload - Decrypted protobuf response from the Garupa API
     * @returns Parsed monthly ranking data with top and border user arrays
     */
    public parse(payload: Buffer): MonthlyRankingBandoriRaw {
        const parsed = garupaParser.decode<GarupaMonthlyRankingRankingResponse>(payload, userMonthlyRankingRankingResponseSchema);
        return this.buildReport(parsed);
    }

    private buildReport(rootFields: GarupaMonthlyRankingRankingResponse): MonthlyRankingBandoriRaw {
        return {
            monthlyRankingPointTopUsers: buildUsers(rootFields.monthlyRankingPointTopUsers),
            monthlyRankingPointBorderUsers: buildUsers(rootFields.monthlyRankingPointBorderUsers),
        };
    }
}

/** Singleton instance of {@link GarupaMonthlyRankingParser} used by the Garupa API client. */
export const bandoriMonthlyRankingParser = new GarupaMonthlyRankingParser();
