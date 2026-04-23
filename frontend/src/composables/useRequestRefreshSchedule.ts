import { calculateTolerance, getLatestTimeStamps } from "@/features/score/scoreMath";
import type { QueryPreferences } from "@/types/preferences";
import type { PlayerTrack } from "@/types/score";

const clampInteger = (value: number, min: number, max?: number): number => {
    const next = Math.round(value);
    const lower = Math.max(min, next);
    return max === undefined ? lower : Math.min(lower, max);
};

const getNextFixedMinuteRefreshAt = (now: number, settings: QueryPreferences): number => {
    const minuteInterval = clampInteger(settings.requestMinuteInterval, 1);
    const second = clampInteger(settings.requestSecond, 0, 59);
    const next = new Date(now);

    next.setMilliseconds(0);
    next.setSeconds(second);

    if (next.getTime() <= now) {
        next.setMinutes(next.getMinutes() + 1);
    }

    while (next.getTime() <= now || next.getMinutes() % minuteInterval !== 0) {
        next.setMinutes(next.getMinutes() + 1);
        next.setSeconds(second);
        next.setMilliseconds(0);
    }

    return next.getTime();
};

const getNextSmartRefreshAt = (settings: QueryPreferences, tracks: PlayerTrack[]): number => {
    const latestTimeStamps = getLatestTimeStamps(tracks);
    const now = Date.now();
    if (!latestTimeStamps.length) latestTimeStamps.push(now);
    const nextBaseTimestamp = latestTimeStamps.at(0) ?? now;
    let targetTime = nextBaseTimestamp + (calculateTolerance(latestTimeStamps) || 61 * 1000);
    while (targetTime < now) targetTime += settings.requestAutoRetryDelaySeconds * 1000;
    return targetTime;
};

export const getNextRefreshAt = (settings: QueryPreferences, tracks: PlayerTrack[]): number => {
    const now = Date.now();

    if (settings.requestMode === "fixed-interval") {
        const intervalSeconds = clampInteger(settings.requestIntervalSeconds, 1);
        return now + intervalSeconds * 1000;
    }

    if (settings.requestMode === "smart-refresh") {
        return getNextSmartRefreshAt(settings, tracks);
    }

    return getNextFixedMinuteRefreshAt(now, settings);
};
