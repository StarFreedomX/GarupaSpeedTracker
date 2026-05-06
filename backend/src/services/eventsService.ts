import { BESTDORI_API } from "@/config";
import { BestdoriEventParser } from "@/parsers";
import { downloader } from "@/storage/downloader";
import type { BestdoriEventsAllRaw, EventListResponse } from "@/types/bestdori";

const parser = new BestdoriEventParser();

const buildEventsUrl = (): string => `${BESTDORI_API}events/all.5.json`;

export const getEventList = async (): Promise<EventListResponse> => {
    const payload = await downloader.downloadCache<BestdoriEventsAllRaw>(buildEventsUrl());
    return parser.buildEventList(payload);
};
