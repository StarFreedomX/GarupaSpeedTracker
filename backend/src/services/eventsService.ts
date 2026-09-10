import { fetchBestdoriEvents } from "@/api/bestdori";
import { logger } from "@/logger";
import { BestdoriEventParser } from "@/parsers/BestdoriEventParser";
import { eventInfoService } from "@/services/eventInfoService";
import type { EventListResponse } from "@/types/bestdori";

const parser = new BestdoriEventParser();

/**
 * Merges Bestdori history with project event metadata, preferring local values.
 *
 * @returns A structured event list response containing all events indexed by ID.
 */
export const getEventList = async (): Promise<EventListResponse> => {
    const [bestdori, local] = await Promise.allSettled([fetchBestdoriEvents(), eventInfoService.getEventInfoList()]);
    if (bestdori.status === "rejected" && local.status === "rejected") {
        throw local.reason;
    }
    for (const [source, result] of [
        ["Bestdori", bestdori],
        ["database", local],
    ] as const) {
        if (result.status === "rejected") {
            logger("eventInfo", `${source} event list unavailable: ${String(result.reason)}`);
        }
    }
    const events = bestdori.status === "fulfilled" ? parser.buildEventList(bestdori.value) : {};
    if (local.status === "fulfilled") {
        for (const [id, event] of Object.entries(local.value)) {
            const previous = events[id];
            const merge = (preferred: Array<string | null>, fallback: Array<string | null> = []): Array<string | null> =>
                Array.from({ length: Math.max(preferred.length, fallback.length) }, (_, server) => preferred[server] ?? fallback[server] ?? null);
            events[id] = {
                eventType: event.eventType || previous?.eventType || null,
                assetBundleName: event.assetBundleName || previous?.assetBundleName || null,
                eventName: merge(event.eventName, previous?.eventName),
                startAt: merge(
                    event.startAt.map((time) => (time === null ? null : String(time))),
                    previous?.startAt,
                ),
                endAt: merge(
                    event.endAt.map((time) => (time === null ? null : String(time))),
                    previous?.endAt,
                ),
            };
        }
    }
    return events;
};
