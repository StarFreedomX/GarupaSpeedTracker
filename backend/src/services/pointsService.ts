import { fetchBestdoriTopPoints } from "@/api/bestdori";
import { MIN_POINTS_UPDATE_TIME } from "@/config";
import { logger } from "@/logger";
import { BestdoriPointsParser } from "@/parsers/BestdoriPointsParser";
import { eventRankingService } from "@/services/eventRankingService";
import { downloader } from "@/storage/downloader";
import type { PointsQueryParams, PointsTrackResponse } from "@/types/bestdori";
import { toMs } from "@/utils";

const parser = new BestdoriPointsParser();

/**
 * Prefers project ranking snapshots, falling back to Bestdori when none are usable.
 *
 * The Bestdori fallback payload is cached with an expiry time derived from its maximum timestamp
 * in the returned data, plus a minimum update interval. The cached response is
 * re-fetched when the expiry time passes.
 *
 * @param params - Query parameters including event/server IDs, tier, and time filters.
 * @returns A structured track response containing point history for the requested tier.
 */
export const getPointTrack = async (params: PointsQueryParams): Promise<PointsTrackResponse> => {
    try {
        const local = await eventRankingService.getEventTopSnapshot(params.server, params.eventId);
        const validPoints = parser.sanitizePoints(local.points);
        if (validPoints.length > 0) {
            // Keep the latest complete snapshot in each requested sampling interval.
            const timesByBucket = new Map<number, number>();
            for (const point of validPoints) {
                const bucket = Math.floor(toMs(point.time) / params.interval);
                timesByBucket.set(bucket, Math.max(timesByBucket.get(bucket) ?? 0, point.time));
            }
            const times = new Set(timesByBucket.values());
            return parser.buildPointTrack(
                { points: validPoints.filter((point) => times.has(point.time)), users: local.users },
                params.time,
                params.lastTimeStamp,
            );
        }
    } catch (error) {
        logger("eventRanking", `local point track unavailable, falling back to Bestdori: ${String(error)}`);
    }

    const payload = await fetchBestdoriTopPoints(params, {
        getExpireAt: (body) => {
            const maxTimestamp = parser.getMaxTimestamp(body);
            if (maxTimestamp === 0) {
                return Date.now() + MIN_POINTS_UPDATE_TIME * 1000;
            }

            return toMs(maxTimestamp) + MIN_POINTS_UPDATE_TIME * 1000;
        },
    });

    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    logger("bestdori", `payload size=${downloader.formatBytes(payloadBytes)}, points=${payload.points.length}, users=${payload.users.length}`);

    return parser.buildPointTrack(payload, params.time, params.lastTimeStamp);
};
