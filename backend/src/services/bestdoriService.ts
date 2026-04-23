import http from "node:http";
import https from "node:https";
import axios from "axios";
import { BESTDORI_API, BESTDORI_TIMEOUT_MS, MIN_UPDATE_TIME } from "@/config";
import { logger } from "@/logger";
import { BestdoriParser } from "@/parsers/BestdoriParser";
import type { BestdoriEventsAllRaw, BestdoriResponseRaw, EventListResponse, ScoreQueryParams, ScoreTrackResponse } from "@/types/bestdori";
import { toMs } from "@/utils";

interface CacheEntry {
    maxTimestamp: number;
    payload: BestdoriResponseRaw;
}

interface ParsedResult {
    payload: BestdoriResponseRaw;
    maxTimestamp: number;
}

const parser = new BestdoriParser();
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ParsedResult>>();

const axiosClient = axios.create({
    timeout: BESTDORI_TIMEOUT_MS,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * Build a stable cache key from upstream identity parameters.
 * Cache scope is server + eventId + interval.
 */
const buildKey = (params: Pick<ScoreQueryParams, "server" | "eventId" | "interval">): string => `${params.server}:${params.eventId}:${params.interval}`;

/**
 * Build Bestdori eventtop endpoint URL.
 * Uses query pattern: server, event, mid=0, interval.
 */
const buildUrl = (params: Pick<ScoreQueryParams, "server" | "eventId" | "interval">): string =>
    `${BESTDORI_API}eventtop/data?${new URLSearchParams({
        server: String(params.server),
        event: String(params.eventId),
        mid: "0",
        interval: String(params.interval),
    }).toString()}`;

const buildEventsUrl = (): string => `${BESTDORI_API}events/all.5.json`;

/**
 * Decide whether an existing cache entry is still reusable.
 * The decision is based on the newest data timestamp from upstream,
 * not local request arrival time.
 */
const shouldReuseCache = (entry: CacheEntry): boolean => {
    if (!entry.maxTimestamp) {
        return false;
    }

    const ageMs = Date.now() - toMs(entry.maxTimestamp);
    return ageMs < MIN_UPDATE_TIME * 1000;
};

/**
 * Fetch raw ranking payload from Bestdori and extract max timestamp.
 *
 * @throws Error & { status: 504 | 502 }
 * Returns 504 on timeout, 502 on other upstream failures.
 */
const fetchAndParse = async (params: ScoreQueryParams): Promise<ParsedResult> => {
    const url = buildUrl(params);
    logger("bestdori", `fetching ${url}`);

    try {
        const response = await axiosClient.get<BestdoriResponseRaw>(url);
        const maxTimestamp = parser.getMaxTimestamp(response.data);
        return { payload: response.data, maxTimestamp };
    } catch (error: unknown) {
        const axiosError = error as { code?: string; message?: string };
        logger("bestdori", `upstream request failed: ${axiosError.message ?? "unknown error"}`);

        const upstreamError = new Error("Bestdori upstream request failed") as Error & { status?: number };
        upstreamError.status = axiosError.code === "ECONNABORTED" ? 504 : 502;
        throw upstreamError;
    }
};

const fetchEventListRaw = async (): Promise<BestdoriEventsAllRaw> => {
    const url = buildEventsUrl();
    logger("bestdori", `fetching ${url}`);

    try {
        const response = await axiosClient.get<BestdoriEventsAllRaw>(url);
        return response.data;
    } catch (error: unknown) {
        const axiosError = error as { code?: string; message?: string };
        logger("bestdori", `upstream request failed: ${axiosError.message ?? "unknown error"}`);

        const upstreamError = new Error("Bestdori upstream request failed") as Error & { status?: number };
        upstreamError.status = axiosError.code === "ECONNABORTED" ? 504 : 502;
        throw upstreamError;
    }
};

/**
 * Get score track data for a time window.
 *
 * Behavior:
 * - Cache hit: reuse payload when newest upstream timestamp is fresh enough.
 * - Cache miss + in-flight exists: join existing Promise to avoid duplicate IO.
 * - Cache miss + no in-flight: request upstream once and share result.
 *
 * @param params server/eventId/interval identify upstream data; time defines response window (minutes).
 * lastTimeStamp optionally limits output to that timestamp and later.
 * @returns Aligned score tracks where missing users at a timestamp are filled with -1.
 */
export const getScoreTrack = async (params: ScoreQueryParams): Promise<ScoreTrackResponse> => {
    const key = buildKey(params);
    const cached = cache.get(key);

    if (cached && shouldReuseCache(cached)) {
        logger("cache", `hit ${key}`);
        return parser.buildScoreTrack(cached.payload, params.time, params.lastTimeStamp);
    }

    const activeRequest = inFlight.get(key);
    if (activeRequest) {
        logger("cache", `join in-flight ${key}`);
        const result = await activeRequest;
        return parser.buildScoreTrack(result.payload, params.time, params.lastTimeStamp);
    }

    const requestPromise = fetchAndParse(params)
        .then((result) => {
            cache.set(key, {
                maxTimestamp: result.maxTimestamp,
                payload: result.payload,
            });
            return result;
        })
        .finally(() => {
            inFlight.delete(key);
        });

    inFlight.set(key, requestPromise);

    const result = await requestPromise;
    return parser.buildScoreTrack(result.payload, params.time, params.lastTimeStamp);
};

export const getEventList = async (): Promise<EventListResponse> => {
    const payload = await fetchEventListRaw();
    return parser.buildEventList(payload);
};
