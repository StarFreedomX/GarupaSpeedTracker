import type { BestdoriPointRaw, BestdoriTopPointsRaw, BestdoriUserRaw, PlayerPointsData, PointsTrackResponse } from "@/types/bestdori";
import { groupPointsByTime, toMs } from "@/utils";

/**
 * Parses and processes Bestdori event top-points tracker data.
 *
 * The raw payload contains per-time-slot point snapshots for the top 10 players.
 * This parser:
 * - **Sanitizes** points by filtering out time slots that have fewer than 10 players
 *   (incomplete snapshots are discarded).
 * - **Builds a time window** within the last N minutes, optionally incremental from a
 *   previous timestamp.
 * - **Constructs per-player point tracks** sorted by the last known point value (descending)
 *   then by UID.
 */
export class BestdoriPointsParser {
    /**
     * Filters points to only include time slots where exactly 10 players have data.
     * Slots with fewer than 10 records are considered incomplete and dropped.
     * @param points - Raw point entries from the Bestdori API
     * @returns Points from valid (complete) time slots only
     */
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

    /**
     * Builds a time-windowed point track from the raw Bestdori top-points payload.
     *
     * Only the last N minutes of data (relative to the latest timestamp in the payload)
     * are included. If `lastTimeStamp` is provided, only points newer than that timestamp
     * are returned (incremental mode).
     *
     * @param payload - Raw Bestdori top-points data
     * @param windowMinutes - Time window size in minutes
     * @param lastTimeStamp - Optional previous snapshot timestamp for incremental updates
     * @returns Array of per-player point tracks sorted by latest point value (desc) then UID
     */
    public buildPointTrack(payload: BestdoriTopPointsRaw, windowMinutes: number, lastTimeStamp?: number): PointsTrackResponse {
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

        const result: PlayerPointsData[] = [];

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

    /**
     * Returns the maximum timestamp (most recent snapshot) from the raw payload.
     * @param payload - Raw Bestdori top-points data
     * @returns The highest timestamp value, or 0 if no points exist
     */
    public getMaxTimestamp(payload: BestdoriTopPointsRaw): number {
        if (payload.points.length === 0) {
            return 0;
        }

        return payload.points.reduce((maxTime, point) => (point.time > maxTime ? point.time : maxTime), 0);
    }
}
