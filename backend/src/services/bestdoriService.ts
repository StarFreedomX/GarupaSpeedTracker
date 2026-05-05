import http from "node:http";
import https from "node:https";
import axios from "axios";
import { BESTDORI_API, BESTDORI_TIMEOUT_MS } from "@/config";
import { logger } from "@/logger";
import { BestdoriParser } from "@/parsers/BestdoriParser";
import { BestdoriPointsCacheStorage } from "@/storage/BestdoriPointsCacheStorage";
import type { BestdoriEventsAllRaw, BestdoriTopPointsRaw, EventListResponse, PointsQueryParams, PointsTrackResponse } from "@/types/bestdori";

interface ParsedResult {
    payload: BestdoriTopPointsRaw;
    maxTimestamp: number;
    payloadBytes: number;
}

const parser = new BestdoriParser();
const pointsCacheStorage = new BestdoriPointsCacheStorage();
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
const buildKey = (params: Pick<PointsQueryParams, "server" | "eventId" | "interval">): string => `${params.server}:${params.eventId}:${params.interval}`;

/**
 * Build Bestdori eventtop endpoint URL.
 * Uses query pattern: server, event, mid=0, interval.
 */
const buildUrl = (params: Pick<PointsQueryParams, "server" | "eventId" | "interval">): string =>
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
const fetchAndParse = async (params: PointsQueryParams): Promise<ParsedResult> => {
    const url = buildUrl(params);
    logger("bestdori", `fetching ${url}`);

    try {
        const response = await axiosClient.get<BestdoriTopPointsRaw>(url);
        const payloadBytes = Buffer.byteLength(JSON.stringify(response.data), "utf8");
        logger(
            "bestdori",
            `payload size=${BestdoriPointsCacheStorage.formatBytes(payloadBytes)}, points=${response.data.points.length}, users=${response.data.users.length}`,
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
 * Get points track data for a time window.
 *
 * Behavior:
 * - Cache hit: reuse payload when newest upstream timestamp is fresh enough.
 * - Cache miss + in-flight exists: join existing Promise to avoid duplicate IO.
 * - Cache miss + no in-flight: request upstream once and share result.
 *
 * @param params server/eventId/interval identify upstream data; time defines response window (minutes).
 * lastTimeStamp optionally limits output to that timestamp and later.
 * @returns Aligned points tracks where missing users at a timestamp are filled with -1.
 */
export const getPointTrack = async (params: PointsQueryParams): Promise<PointsTrackResponse> => {
    const key = buildKey(params);
    const cached = await pointsCacheStorage.get(params, key);
    if (cached) {
        logger(
            "cache",
            `${cached.source} hit ${key} size=${BestdoriPointsCacheStorage.formatBytes(cached.entry.payloadBytes)} entries=${pointsCacheStorage.getMemoryEntryCount()}`,
        );
        return parser.buildPointTrack(cached.entry.payload, params.time, params.lastTimeStamp);
    }

    const activeRequest = inFlight.get(key);
    if (activeRequest) {
        logger("cache", `join in-flight ${key}`);
        const result = await activeRequest;
        return parser.buildPointTrack(result.payload, params.time, params.lastTimeStamp);
    }

    const requestPromise = fetchAndParse(params)
        .then(async (result) => {
            const entry = await pointsCacheStorage.set(params, key, result);
            logger(
                "cache",
                `store memory ${key} size=${BestdoriPointsCacheStorage.formatBytes(entry.payloadBytes)} entries=${pointsCacheStorage.getMemoryEntryCount()}`,
            );

            return result;
        })
        .finally(() => {
            inFlight.delete(key);
        });

    inFlight.set(key, requestPromise);

    const result = await requestPromise;
    return parser.buildPointTrack(result.payload, params.time, params.lastTimeStamp);
};

export const getEventList = async (): Promise<EventListResponse> => {
    const payload = await fetchEventListRaw();
    return parser.buildEventList(payload);
};
