import type { BestdoriEventsAllRaw, EventListResponse } from "@/types/bestdori";

/**
 * Parses the Bestdori event list JSON (all.5.json) into a normalized {@link EventListResponse}.
 *
 * The raw Bestdori payload is a flat JSON object keyed by event ID. This parser extracts
 * the core event metadata (type, name, timestamps, asset bundle name) and discards
 * null entries.
 */
export class BestdoriEventParser {
    /**
     * Builds a normalized event list from the raw Bestdori events JSON payload.
     * @param payload - Raw Bestdori events data (all.5.json)
     * @returns An event list keyed by string event ID with essential metadata
     */
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
