import type {
    BestdoriEventsAllRaw,
    BestdoriPointRaw,
    BestdoriResponseRaw,
    BestdoriUserRaw,
    EventListResponse,
    PlayerScoreData,
    ScoreTrackResponse,
} from "@/types/bestdori";
import { groupPointsByTime, toMs } from "@/utils";

/**
 * Handles Bestdori payload normalization:
 * 1) removes abnormal timestamps (count !== 10)
 * 2) keeps points in requested recent window
 * 3) aligns all users on same timestamps and fills gaps with -1
 */
export class BestdoriParser {
    public buildEventList(payload: BestdoriEventsAllRaw): EventListResponse {
        const result: EventListResponse = {};

        for (const [eventId, event] of Object.entries(payload)) {
            if (!event) {
                continue;
            }

            result[eventId] = {
                eventType: event.eventType ?? null,
                eventName: event.eventName ?? [],
                assetBundleName: event.assetBundleName ?? null,
                startAt: event.startAt ?? [],
                endAt: event.endAt ?? [],
            };
        }

        return result;
    }

    public sanitizePoints(points: BestdoriPointRaw[]): BestdoriPointRaw[] {
        const grouped = groupPointsByTime(points);
        const validTimes = new Set<number>();

        for (const [time, rows] of grouped) {
            if (rows.length === 10) {
                validTimes.add(time);
            }
        }

        return points.filter((point) => validTimes.has(point.time));
    }

    public buildScoreTrack(payload: BestdoriResponseRaw, windowMinutes: number, lastTimeStamp?: number): ScoreTrackResponse {
        const validPoints = this.sanitizePoints(payload.points);
        if (validPoints.length === 0) {
            return [];
        }

        const sortedTimes = Array.from(new Set(validPoints.map((point) => point.time))).sort((a, b) => a - b);
        const latestTime = sortedTimes[sortedTimes.length - 1];
        const thresholdMs = toMs(latestTime) - windowMinutes * 60 * 1000;
        const windowTimes = sortedTimes.filter((time) => toMs(time) >= thresholdMs);
        const incrementalTimes = lastTimeStamp === undefined ? windowTimes : windowTimes.filter((time) => toMs(time) >= toMs(lastTimeStamp));
        if (incrementalTimes.length === 0) {
            return [];
        }
        const windowTimeSet = new Set(incrementalTimes);

        const filtered = validPoints.filter((point) => windowTimeSet.has(point.time));
        const usersMap = new Map<number, BestdoriUserRaw>(payload.users.map((user) => [user.uid, user]));

        const uidSet = new Set<number>(filtered.map((point) => point.uid));
        const pointsByUidTime = new Map<string, number>();

        for (const row of filtered) {
            pointsByUidTime.set(`${row.uid}-${row.time}`, row.value);
        }

        const result: PlayerScoreData[] = [];

        for (const uid of uidSet) {
            const user = usersMap.get(uid);
            result.push({
                uid,
                points: incrementalTimes.map((time) => ({
                    time,
                    points: pointsByUidTime.get(`${uid}-${time}`) ?? -1,
                })),
                info: {
                    name: user?.name ?? `UID-${uid}`,
                    introduction: user?.introduction ?? "",
                },
            });
        }

        return result.sort((a, b) => {
            const lastA = [...a.points].reverse().find((point) => point.points !== -1)?.points ?? -1;
            const lastB = [...b.points].reverse().find((point) => point.points !== -1)?.points ?? -1;

            if (lastA !== lastB) {
                return lastB - lastA;
            }

            return a.uid - b.uid;
        });
    }

    public getMaxTimestamp(payload: BestdoriResponseRaw): number {
        if (payload.points.length === 0) {
            return 0;
        }

        return payload.points.reduce((maxTime, point) => (point.time > maxTime ? point.time : maxTime), 0);
    }
}
