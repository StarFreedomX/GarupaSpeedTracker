import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaMasterMonthlyRanking, GarupaMasterMonthlyRankingListResponse } from "@/types/garupaSchema/monthlyRankingSchema";
import { masterMonthlyRankingListSchema } from "@/types/garupaSchema/monthlyRankingSchema";
import type { MonthlyRankingDetail, MonthlyRankingDetailList } from "@/types/monthlyRanking";

const garupaParser = new GarupaParser();

const toNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const createNullableArray = <T>(length: number, value: T | null): Array<T | null> => Array.from({ length }, () => value);

const toMonthlyRankingDetail = (entry: GarupaMasterMonthlyRanking, server: number, serverCount: number): MonthlyRankingDetail => {
    const monthlyRankingName = createNullableArray<string>(serverCount, null);
    const startAt = createNullableArray<number>(serverCount, null);
    const endAt = createNullableArray<number>(serverCount, null);
    const enableFlag = createNullableArray<boolean>(serverCount, null);
    const publicStartAt = createNullableArray<number>(serverCount, null);
    const publicEndAt = createNullableArray<number>(serverCount, null);
    const distributionStartAt = createNullableArray<number>(serverCount, null);
    const distributionEndAt = createNullableArray<number>(serverCount, null);
    const aggregateEndAt = createNullableArray<number>(serverCount, null);
    const receptionEndAt = createNullableArray<number>(serverCount, null);
    const rewards = createNullableArray<NonNullable<MonthlyRankingDetail["rewards"]>[number]>(serverCount, null);
    const grades = createNullableArray<NonNullable<MonthlyRankingDetail["grades"]>[number]>(serverCount, null);

    monthlyRankingName[server] = entry.monthlyRankingName ?? null;
    startAt[server] = toNumber(entry.startAt);
    endAt[server] = toNumber(entry.endAt);
    enableFlag[server] = typeof entry.enableFlg === "boolean" ? entry.enableFlg : null;
    publicStartAt[server] = toNumber(entry.publicStartAt);
    publicEndAt[server] = toNumber(entry.publicEndAt);
    distributionStartAt[server] = toNumber(entry.distributionStartAt);
    distributionEndAt[server] = toNumber(entry.distributionEndAt);
    aggregateEndAt[server] = toNumber(entry.aggregateEndAt);
    receptionEndAt[server] = toNumber(entry.receptionEndAt);
    rewards[server] = entry.rewards ?? null;
    grades[server] = entry.grades ?? null;

    return {
        monthlyRankingId: entry.monthlyRankingId ?? 0,
        monthlyRankingName,
        assetBundleName: entry.assetBundleName ?? "",
        bgmFileName: entry.bgmFileName ?? "",
        startAt,
        endAt,
        enableFlag,
        publicStartAt,
        publicEndAt,
        distributionStartAt,
        distributionEndAt,
        aggregateEndAt,
        receptionEndAt,
        rewards,
        grades,
    };
};

export class GarupaMonthlyRankingInfoParser {
    public parse(payload: Buffer, server: number, serverCount: number): MonthlyRankingDetailList {
        const parsed = garupaParser.decode<GarupaMasterMonthlyRankingListResponse>(payload, masterMonthlyRankingListSchema);
        const out: MonthlyRankingDetailList = {};
        const entries = parsed.entries ?? [];

        for (const entry of entries) {
            const monthlyRankingId = toNumber(entry.monthlyRankingId);
            if (!monthlyRankingId || monthlyRankingId <= 0) {
                continue;
            }

            out[String(monthlyRankingId)] = {
                ...toMonthlyRankingDetail(entry, server, serverCount),
                monthlyRankingId,
            };
        }

        return out;
    }
}

export const garupaMonthlyRankingInfoParser = new GarupaMonthlyRankingInfoParser();
