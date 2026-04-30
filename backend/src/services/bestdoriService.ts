import http from "node:http";
import https from "node:https";
import axios from "axios";
import { BESTDORI_API, BESTDORI_TIMEOUT_MS } from "@/config";
import { logger } from "@/logger";
import { BestdoriParser } from "@/parsers/BestdoriParser";
import { BestdoriScoreCacheStorage } from "@/storage/BestdoriScoreCacheStorage";
import type { BestdoriEventsAllRaw, BestdoriResponseRaw, EventListResponse, ScoreQueryParams, ScoreTrackResponse } from "@/types/bestdori";

interface ParsedResult {
    payload: BestdoriResponseRaw;
    maxTimestamp: number;
    payloadBytes: number;
}

const parser = new BestdoriParser();
const scoreCacheStorage = new BestdoriScoreCacheStorage();
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
        const payloadBytes = Buffer.byteLength(JSON.stringify(response.data), "utf8");
        logger(
            "bestdori",
            `payload size=${BestdoriScoreCacheStorage.formatBytes(payloadBytes)}, points=${response.data.points.length}, users=${response.data.users.length}`,
        );
        const maxTimestamp = parser.getMaxTimestamp(response.data);
        return { payload: response.data, maxTimestamp, payloadBytes };
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
    const cached = await scoreCacheStorage.get(params, key);
    if (cached) {
        logger(
            "cache",
            `${cached.source} hit ${key} size=${BestdoriScoreCacheStorage.formatBytes(cached.entry.payloadBytes)} entries=${scoreCacheStorage.getMemoryEntryCount()}`,
        );
        return parser.buildScoreTrack(cached.entry.payload, params.time, params.lastTimeStamp);
    }

    const activeRequest = inFlight.get(key);
    if (activeRequest) {
        logger("cache", `join in-flight ${key}`);
        const result = await activeRequest;
        return parser.buildScoreTrack(result.payload, params.time, params.lastTimeStamp);
    }

    const requestPromise = fetchAndParse(params)
        .then(async (result) => {
            const entry = await scoreCacheStorage.set(params, key, result);
            logger(
                "cache",
                `store memory ${key} size=${BestdoriScoreCacheStorage.formatBytes(entry.payloadBytes)} entries=${scoreCacheStorage.getMemoryEntryCount()}`,
            );

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
