import { translate } from "@/i18n";
import { getApiBase } from "@/services/apiBase";
import type { PlayerTrack, PointsQuery, PointsResponse } from "@/types/points";

const toPlayerArray = (data: PointsResponse): PlayerTrack[] => {
    if (Array.isArray(data)) {
        return data;
    }

    return Object.entries(data).map(([uid, value]) => ({
        uid: Number(uid),
        info: value.info,
        points: value.points,
    }));
};

export const fetchPoints = async (query: PointsQuery): Promise<PlayerTrack[]> => {
    const search = new URLSearchParams({
        server: String(query.server),
        event: String(query.event),
        time: String(query.time),
    });

    if (query.interval !== undefined) {
        search.set("interval", String(query.interval));
    }

    if (query.lastTimeStamp !== undefined) {
        search.set("lastTimeStamp", String(query.lastTimeStamp));
    }

    const response = await fetch(`${getApiBase()}/topPoints?${search.toString()}`);
    if (!response.ok) {
        throw new Error(translate("error.requestFailed", { status: response.status }));
    }

    const data = (await response.json()) as PointsResponse;
    return toPlayerArray(data);
};
