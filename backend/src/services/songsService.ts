import { BESTDORI_API } from "@/config";
import { downloader } from "@/storage/downloader";
import type { MusicDataResponse } from "@/types/bestdori/songs";

const buildEventsUrl = (): string => `${BESTDORI_API}/songs/all.5.json`;

export const getSongsList = async (): Promise<MusicDataResponse> => {
    return await downloader.downloadCache<MusicDataResponse>(buildEventsUrl());
};
