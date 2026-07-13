import { fetchBestdoriEvents } from "@/api/bestdori";
import { BestdoriEventParser } from "@/parsers";
import type { EventListResponse } from "@/types/bestdori";

const parser = new BestdoriEventParser();

/**
 * Fetches the full event list from Bestdori and builds a normalized response.
 *
 * @returns A structured event list response containing all events indexed by ID.
 */
export const getEventList = async (): Promise<EventListResponse> => {
    const payload = await fetchBestdoriEvents();
    return parser.buildEventList(payload);
};
