import { fetchBestdoriTopPoints } from "@/api/bestdori";
import { MIN_POINTS_UPDATE_TIME } from "@/config";
import { logger } from "@/logger";
import { BestdoriPointsParser } from "@/parsers/BestdoriPointsParser";
import { downloader } from "@/storage/downloader";
import type { PointsQueryParams, PointsTrackResponse } from "@/types/bestdori";
import { toMs } from "@/utils";

const parser = new BestdoriPointsParser();

export const getPointTrack = async (params: PointsQueryParams): Promise<PointsTrackResponse> => {
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
