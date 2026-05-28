import { fetchBestdoriEvents } from "@/api/bestdori";
import { BestdoriEventParser } from "@/parsers";
import type { EventListResponse } from "@/types/bestdori";

const parser = new BestdoriEventParser();

export const getEventList = async (): Promise<EventListResponse> => {
    const payload = await fetchBestdoriEvents();
    return parser.buildEventList(payload);
};
