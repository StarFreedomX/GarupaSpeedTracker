import { translate } from "@/i18n";
import { getApiBase } from "@/services/apiBase";
import type { PlayerTrack, ScoreQuery, ScoreResponse } from "@/types/score";

const toPlayerArray = (data: ScoreResponse): PlayerTrack[] => {
    if (Array.isArray(data)) {
        return data;
    }

    return Object.entries(data).map(([uid, value]) => ({
        uid: Number(uid),
        info: value.info,
        points: value.points,
    }));
};

export const fetchScores = async (query: ScoreQuery): Promise<PlayerTrack[]> => {
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

    const response = await fetch(`${getApiBase()}/scores?${search.toString()}`);
    if (!response.ok) {
        throw new Error(translate("error.requestFailed", { status: response.status }));
    }

    const data = (await response.json()) as ScoreResponse;
    return toPlayerArray(data);
};
