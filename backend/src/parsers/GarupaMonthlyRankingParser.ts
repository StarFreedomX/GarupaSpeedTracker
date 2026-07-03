import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaMonthlyRankingRankingResponse, GarupaRankingUser } from "@/types/garupaSchema";
import { userMonthlyRankingRankingResponseSchema } from "@/types/garupaSchema";
import type { MonthlyRankingBandoriRaw, MonthlyRankingTopUserRaw } from "@/types/monthlyRanking";

const garupaParser = new GarupaParser();

const toNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const buildDegrees = (user: GarupaRankingUser): number[] => {
    const entries = user.userProfileDegreeMap?.entries ?? [];
    return entries.map((entry) => toNumber(entry.value?.degreeId)).filter((value) => Number.isFinite(value));
};

const parseUser = (user: GarupaRankingUser): MonthlyRankingTopUserRaw => {
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

const buildUsers = (container?: { entries?: GarupaRankingUser[] }): MonthlyRankingTopUserRaw[] => {
    const rows = container?.entries ?? [];
    return rows.map((user) => parseUser(user));
};

export class GarupaMonthlyRankingParser {
    public parse(payload: Buffer): MonthlyRankingBandoriRaw {
        const parsed = garupaParser.decode<GarupaMonthlyRankingRankingResponse>(payload, userMonthlyRankingRankingResponseSchema);
        return this.buildReport(parsed);
    }

    private buildReport(rootFields: GarupaMonthlyRankingRankingResponse): MonthlyRankingBandoriRaw {
        const report: MonthlyRankingBandoriRaw = {
            monthlyRankingPointTopUsers: [],
            monthlyRankingPointBorderUsers: [],
        };

        report.monthlyRankingPointTopUsers = buildUsers(rootFields.monthlyRankingPointTopUsers);
        report.monthlyRankingPointBorderUsers = buildUsers(rootFields.monthlyRankingPointBorderUsers);

        return report;
    }
}

export const bandoriMonthlyRankingParser = new GarupaMonthlyRankingParser();
