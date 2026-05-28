import { BESTDORI_API } from "@/config";
import { type DownloadCacheOptions, downloader } from "@/storage/downloader";
import type { BestdoriEventsAllRaw, BestdoriTopPointsRaw, PointsQueryParams } from "@/types/bestdori";
import type { Chart } from "@/types/bestdori/chart";
import type { MusicDataResponse } from "@/types/bestdori/songs";

export interface BestdoriDownloaderLike {
    download<T>(url: string): Promise<T>;
    downloadCache<T>(url: string, options?: DownloadCacheOptions<T>): Promise<T>;
}

const toBestdoriUrl = (path: string): string => new URL(path.replace(/^\/+/, ""), BESTDORI_API).toString();

const buildEventsUrl = (): string => toBestdoriUrl("events/all.5.json");
const buildSongsUrl = (): string => toBestdoriUrl("songs/all.5.json");
const buildChartUrl = (songId: number, difficultyName: string): string => toBestdoriUrl(`charts/${songId}/${difficultyName}.json`);

const buildTopPointsUrl = (params: Pick<PointsQueryParams, "server" | "eventId" | "interval">): string => {
    const url = new URL("eventtop/data", BESTDORI_API);
    url.searchParams.set("server", String(params.server));
    url.searchParams.set("event", String(params.eventId));
    url.searchParams.set("mid", "0");
    url.searchParams.set("interval", String(params.interval));
    return url.toString();
};

export const fetchBestdoriEvents = async (deps: BestdoriDownloaderLike = downloader): Promise<BestdoriEventsAllRaw> =>
    deps.downloadCache<BestdoriEventsAllRaw>(buildEventsUrl());

export const fetchBestdoriSongs = async (
    options?: DownloadCacheOptions<MusicDataResponse>,
    deps: BestdoriDownloaderLike = downloader,
): Promise<MusicDataResponse> => deps.downloadCache<MusicDataResponse>(buildSongsUrl(), options);

export const fetchBestdoriTopPoints = async (
    params: Pick<PointsQueryParams, "server" | "eventId" | "interval">,
    options?: DownloadCacheOptions<BestdoriTopPointsRaw>,
    deps: BestdoriDownloaderLike = downloader,
): Promise<BestdoriTopPointsRaw> => deps.downloadCache<BestdoriTopPointsRaw>(buildTopPointsUrl(params), options);

export const fetchBestdoriChart = async (songId: number, difficultyName: string, deps: BestdoriDownloaderLike = downloader): Promise<Chart> =>
    deps.download<Chart>(buildChartUrl(songId, difficultyName));
