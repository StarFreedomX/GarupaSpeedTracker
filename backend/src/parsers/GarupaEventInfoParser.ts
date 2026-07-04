import { GarupaParser } from "@/parsers/GarupaParser";
import type { EventDetail, EventDetailList } from "@/types/event";
import type { GarupaMasterEvent, GarupaMasterEventListResponse } from "@/types/garupaSchema";
import { masterEventListSchema } from "@/types/garupaSchema";

const garupaParser = new GarupaParser();

const toNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const createNullableArray = <T>(length: number, value: T | null): Array<T | null> => Array.from({ length }, () => value);

const toBooleanOrNull = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const toEventDetail = (entry: GarupaMasterEvent, server: number, serverCount: number): EventDetail => {
    const eventName = createNullableArray<string>(serverCount, null);
    const startAt = createNullableArray<number>(serverCount, null);
    const endAt = createNullableArray<number>(serverCount, null);
    const enableFlag = createNullableArray<boolean>(serverCount, null);
    const publicStartAt = createNullableArray<number>(serverCount, null);
    const publicEndAt = createNullableArray<number>(serverCount, null);
    const distributionStartAt = createNullableArray<number>(serverCount, null);
    const distributionEndAt = createNullableArray<number>(serverCount, null);
    const aggregateEndAt = createNullableArray<number>(serverCount, null);
    const receptionEndAt = createNullableArray<number>(serverCount, null);
    const pointRewards = createNullableArray<NonNullable<EventDetail["pointRewards"]>[number]>(serverCount, null);
    const rankingRewards = createNullableArray<NonNullable<EventDetail["rankingRewards"]>[number]>(serverCount, null);

    eventName[server] = entry.eventName ?? null;
    startAt[server] = toNumber(entry.startAt);
    endAt[server] = toNumber(entry.endAt);
    enableFlag[server] = toBooleanOrNull(entry.enableFlg);
    publicStartAt[server] = toNumber(entry.publicStartAt);
    publicEndAt[server] = toNumber(entry.publicEndAt);
    distributionStartAt[server] = toNumber(entry.distributionStartAt);
    distributionEndAt[server] = toNumber(entry.distributionEndAt);
    aggregateEndAt[server] = toNumber(entry.aggregateEndAt);
    receptionEndAt[server] = toNumber(entry.receptionEndAt);
    pointRewards[server] = entry.pointRewards ?? null;
    rankingRewards[server] = entry.rankingRewards ?? null;

    return {
        eventType: entry.eventType ?? "",
        eventName,
        assetBundleName: entry.assetBundleName ?? "",
        bgmFileName: entry.bgmFileName ?? "",
        startAt,
        endAt,
        eventId: entry.eventId ?? 0,
        enableFlag,
        publicStartAt,
        publicEndAt,
        distributionStartAt,
        distributionEndAt,
        aggregateEndAt,
        receptionEndAt,
        pointRewards,
        rankingRewards,
    };
};

export class GarupaEventInfoParser {
    public parse(payload: Buffer, server: number, serverCount: number): EventDetailList {
        const parsed = garupaParser.decode<GarupaMasterEventListResponse>(payload, masterEventListSchema);
        const out: EventDetailList = {};
        const entries = parsed.entries ?? [];

        for (const entry of entries) {
            const eventId = toNumber(entry.eventId);
            if (!eventId || eventId <= 0) {
                continue;
            }

            out[String(eventId)] = {
                ...toEventDetail(entry, server, serverCount),
                eventId,
            };
        }

        return out;
    }
}

export const garupaEventInfoParser = new GarupaEventInfoParser();
