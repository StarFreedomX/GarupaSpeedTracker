import type { PlayerTrack } from "@/types/points";
import { floorDisplayHour, toMs } from "@/utils/time";

const HOUR = 3_600_000;
export interface HourlyRow {
    uid: number; name: string; rank: number; points: number; gap: number | null;
    speed: number; speedRank: number | null; usesTenthPlaceBaseline: boolean;
    changes: number | null; firstBlank: number | null; lastBlank: number | null; average: number | null;
}
export interface HourlySnapshot {
    hour: number; start: number; end: number; partial: boolean; rows: HourlyRow[];
}

/** Match 前十车速: use the last snapshot at/before the hour, then the last
 * snapshot strictly before end - 60 min. New entrants use the old tenth score.
 * Never interpolate scores or interpret a missing player as zero.
 */
export function toHourlySnapshots(tracks: PlayerTrack[], eventStart = 0, eventEnd = Number.POSITIVE_INFINITY): HourlySnapshot[] {
    const groups = new Map<number, Map<number, number>>();
    for (const player of tracks) for (const point of player.points) {
        const time = toMs(point.time);
        if (time < eventStart || time > eventEnd || point.points < 0) continue;
        const group = groups.get(time) ?? new Map<number, number>();
        group.set(player.uid, point.points);
        groups.set(time, group);
    }
    const times = [...groups.keys()].filter(time => groups.get(time)?.size === 10).sort((a, b) => a - b);
    if (times.length < 2) return [];
    const latest = times[times.length - 1];
    const result: HourlySnapshot[] = [];
    for (let hour = floorDisplayHour(latest); hour > times[0] && result.length < 24; hour -= HOUR) {
        const endIndex = times.findLastIndex(time => time <= hour);
        if (endIndex < 1) continue;
        const end = times[endIndex];
        // Do not repeat stale data as a new hourly report during an outage.
        if (hour - end >= HOUR) continue;
        let startIndex = times.findLastIndex(time => time < end - HOUR);
        if (startIndex < 0) startIndex = 0;
        if (startIndex === endIndex) continue;
        const start = times[startIndex];
        const old = groups.get(start);
        const current = groups.get(end);
        if (!old || !current) continue;
        const ranking = [...current].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
        const fallback = Math.min(...old.values());
        const rows: HourlyRow[] = ranking.map(([uid, points], index) => {
            const samples = times.slice(startIndex, endIndex + 1).map(time => ({ time, points: groups.get(time)?.get(uid) }));
            const missing = samples.some(sample => sample.points === undefined);
            const changes = samples.slice(1).filter((sample, i) => sample.points !== samples[i].points);
            const speed = points - (old.get(uid) ?? fallback);
            return {
                uid, name: tracks.find(player => player.uid === uid)?.info.name ?? String(uid),
                rank: index + 1, points, gap: index ? ranking[index - 1][1] - points : null,
                speed, speedRank: null, usesTenthPlaceBaseline: !old.has(uid),
                changes: missing ? null : changes.length,
                firstBlank: !missing && changes.length ? Math.round((changes[0].time - start) / 60_000) : null,
                lastBlank: !missing && changes.length ? Math.round((end - changes[changes.length - 1].time) / 60_000) : null,
                average: !missing && changes.length ? Math.floor(speed / changes.length) : null,
            };
        });
        [...rows].sort((a, b) => b.speed - a.speed || a.rank - b.rank).forEach((row, i) => { row.speedRank = row.speed > 0 ? i + 1 : null; });
        result.push({ hour, start, end, partial: end - start < HOUR, rows });
    }
    return result;
}
