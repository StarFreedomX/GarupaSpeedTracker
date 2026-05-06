import { BESTDORI_API, MIN_POINTS_UPDATE_TIME } from "@/config";
import { logger } from "@/logger";
import { BestdoriPointsParser } from "@/parsers/BestdoriPointsParser";
import { downloader } from "@/storage/downloader";
import type { BestdoriTopPointsRaw, PointsQueryParams, PointsTrackResponse } from "@/types/bestdori";
import { toMs } from "@/utils";

const parser = new BestdoriPointsParser();

const buildTopPointsUrl = (params: Pick<PointsQueryParams, "server" | "eventId" | "interval">): string =>
    `${BESTDORI_API}eventtop/data?${new URLSearchParams({
        server: String(params.server),
        event: String(params.eventId),
        mid: "0",
        interval: String(params.interval),
    }).toString()}`;

export const getPointTrack = async (params: PointsQueryParams): Promise<PointsTrackResponse> => {
    const url = buildTopPointsUrl(params);
    const payload = await downloader.downloadCache<BestdoriTopPointsRaw>(url, {
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
