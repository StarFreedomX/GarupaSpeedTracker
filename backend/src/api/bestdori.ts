import { BESTDORI_API } from "@/config";
import { type DownloadCacheOptions, downloader } from "@/storage/downloader";
import type { BestdoriEventFullRaw, BestdoriEventsAllRaw, BestdoriTopPointsRaw, PointsQueryParams } from "@/types/bestdori";
import type { Chart } from "@/types/bestdori/chart";
import type { MusicDataResponse } from "@/types/bestdori/songs";

/** Dependency-injection interface for downloading Bestdori API data, allowing tests to substitute a custom downloader. */
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

/**
 * Fetches the Bestdori events summary (all.5.json).
 * Uses downloader cache with default caching strategy.
 */
export const fetchBestdoriEvents = async (deps: BestdoriDownloaderLike = downloader): Promise<BestdoriEventsAllRaw> =>
    deps.downloadCache<BestdoriEventsAllRaw>(buildEventsUrl());

/**
 * Fetches full Bestdori event details (all.5.json) with per-event expanded objects.
 * Uses downloader cache with default caching strategy.
 */
export const fetchBestdoriEventsFull = async (deps: BestdoriDownloaderLike = downloader): Promise<Record<string, BestdoriEventFullRaw>> =>
    deps.downloadCache<Record<string, BestdoriEventFullRaw>>(buildEventsUrl());

/**
 * Fetches the Bestdori song/music data (all.5.json).
 * Accepts optional cache options (e.g. `{ forceUpdate: true }`) to bypass cache.
 */
export const fetchBestdoriSongs = async (
    options?: DownloadCacheOptions<MusicDataResponse>,
    deps: BestdoriDownloaderLike = downloader,
): Promise<MusicDataResponse> => deps.downloadCache<MusicDataResponse>(buildSongsUrl(), options);

/**
 * Fetches Bestdori event top points tracker data for a given server, event ID, and interval.
 * Accepts optional cache options (e.g. `{ forceUpdate: true }`) to force a refresh.
 */
export const fetchBestdoriTopPoints = async (
    params: Pick<PointsQueryParams, "server" | "eventId" | "interval">,
    options?: DownloadCacheOptions<BestdoriTopPointsRaw>,
    deps: BestdoriDownloaderLike = downloader,
): Promise<BestdoriTopPointsRaw> => deps.downloadCache<BestdoriTopPointsRaw>(buildTopPointsUrl(params), options);

/**
 * Fetches a single chart JSON from Bestdori by song ID and difficulty name.
 * Uses direct download (no cache) as chart data is typically immutable.
 */
export const fetchBestdoriChart = async (songId: number, difficultyName: string, deps: BestdoriDownloaderLike = downloader): Promise<Chart> =>
    deps.download<Chart>(buildChartUrl(songId, difficultyName));

/** Fetches a player profile from Bestdori by server name and player ID. */
export const fetchBestdoriPlayer = async (serverName: string, playerId: number, deps: BestdoriDownloaderLike = downloader) => {
    const url = toBestdoriUrl(`player/${serverName}/${playerId}?mode=2`);
    return deps.download<{
        result: boolean;
        data?: { profile?: Record<string, unknown> };
    }>(url);
};

/** Fetches all card metadata in bulk (all.5.json). Uses cache by default; pass `{ forceUpdate: true }` to force a refresh. */
export const fetchBestdoriCardsBulk = async (opts?: DownloadCacheOptions<Record<string, Record<string, unknown>>>, deps: BestdoriDownloaderLike = downloader) =>
    deps.downloadCache<Record<string, Record<string, unknown>>>(toBestdoriUrl("cards/all.5.json"), opts);

/** Fetches area items data from Bestdori. */
export const fetchBestdoriAreaItems = async (deps: BestdoriDownloaderLike = downloader) =>
    deps.downloadCache<Record<string, Record<string, unknown>>>(toBestdoriUrl("areaItems/main.5.json"));

/** Fetches skill data from Bestdori. Uses cache by default; pass `{ forceUpdate: true }` to force a refresh. */
export const fetchBestdoriSkills = async (opts?: DownloadCacheOptions<Record<string, Record<string, unknown>>>, deps: BestdoriDownloaderLike = downloader) =>
    deps.downloadCache<Record<string, Record<string, unknown>>>(toBestdoriUrl("skills/all.10.json"), opts);

/** Fetches the character-to-band mapping from Bestdori. */
export const fetchBestdoriCharacters = async (deps: BestdoriDownloaderLike = downloader) =>
    deps.downloadCache<Record<string, { bandId: number }>>(toBestdoriUrl("characters/main.2.json"));
