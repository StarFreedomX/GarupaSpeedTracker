import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaMasterMonthlyRanking, GarupaMasterMonthlyRankingListResponse } from "@/types/garupaSchema/monthlyRankingSchema";
import { masterMonthlyRankingListSchema } from "@/types/garupaSchema/monthlyRankingSchema";
import type { MonthlyRankingInfo, MonthlyRankingInfoList } from "@/types/monthlyRanking";

const garupaParser = new GarupaParser();

const toNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const createNullableArray = <T>(length: number, value: T | null): Array<T | null> => Array.from({ length }, () => value);

const toMonthlyRankingInfo = (entry: GarupaMasterMonthlyRanking, server: number, serverCount: number): MonthlyRankingInfo => {
    const monthlyRankingName = createNullableArray<string>(serverCount, null);
    const startAt = createNullableArray<number>(serverCount, null);
    const endAt = createNullableArray<number>(serverCount, null);

    monthlyRankingName[server] = entry.monthlyRankingName ?? null;
    startAt[server] = toNumber(entry.startAt);
    endAt[server] = toNumber(entry.endAt);

    return {
        monthlyRankingName,
        assetBundleName: entry.assetBundleName ?? "",
        bgmFileName: entry.bgmFileName ?? "",
        startAt,
        endAt,
    };
};

export class GarupaMonthlyRankingInfoParser {
    public parse(payload: Buffer, server: number, serverCount: number): MonthlyRankingInfoList {
        const parsed = garupaParser.decode<GarupaMasterMonthlyRankingListResponse>(payload, masterMonthlyRankingListSchema);
        const out: MonthlyRankingInfoList = {};
        const entries = parsed.entries ?? [];

        for (const entry of entries) {
            const monthlyRankingId = toNumber(entry.monthlyRankingId);
            if (!monthlyRankingId || monthlyRankingId <= 0) {
                continue;
            }

            out[String(monthlyRankingId)] = toMonthlyRankingInfo(entry, server, serverCount);
        }

        return out;
    }
}

export const garupaMonthlyRankingInfoParser = new GarupaMonthlyRankingInfoParser();
