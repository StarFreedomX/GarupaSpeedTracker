import type { BestdoriEventsAllRaw, EventListResponse } from "@/types/bestdori";

export class BestdoriEventParser {
    public buildEventList(payload: BestdoriEventsAllRaw): EventListResponse {
        const result: EventListResponse = {};

        for (const [eventId, event] of Object.entries(payload)) {
            if (!event) {
                continue;
            }

            result[eventId] = {
                eventType: event.eventType ?? null,
                eventName: event.eventName ?? [],
                assetBundleName: event.assetBundleName ?? null,
                startAt: event.startAt ?? [],
                endAt: event.endAt ?? [],
            };
        }

        return result;
    }
}
