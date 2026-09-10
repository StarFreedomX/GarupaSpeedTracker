import { describe, expect, it } from "vitest";
import { toHourlySnapshots } from "./hourlyMath";
import type { PlayerTrack } from "@/types/points";

const base = Date.UTC(2026, 8, 10, 0);
function fixture(minutes = [0, 30, 59, 60, 90, 119, 120]): PlayerTrack[] {
    return Array.from({ length: 10 }, (_, i) => ({ uid: i + 1, info: { name: `Player ${i}`, introduction: "" }, points: minutes.map(min => ({ time: base + min * 60000, points: (10 - i) * 100000 + min * (i + 1) * 100 })) }));
}
describe("hourly snapshots", () => {
    it("creates descending whole-hour tables using reference strict-before baseline", () => {
        const [latest, previous] = toHourlySnapshots(fixture());
        expect(latest.hour).toBe(base + 120 * 60000);
        expect(latest.start).toBe(base + 59 * 60000);
        expect(latest.rows[0]).toMatchObject({ rank: 1, speed: 6100, changes: 4, average: 1525, firstBlank: 1, lastBlank: 0, speedRank: 10 });
        expect(previous.hour).toBe(base + 60 * 60000);
    });
    it("does not use future samples or fabricate reports during outages", () => {
        const result = toHourlySnapshots(fixture([0, 30, 59, 61, 239, 240]));
        expect(result.find(s => s.hour === base + 60 * 60000)?.end).toBe(base + 59 * 60000);
        expect(result.some(s => s.hour === base + 180 * 60000)).toBe(false);
    });
    it("marks new entrant baseline fallbacks and unavailable change counts", () => {
        const tracks = fixture();
        const entrant = { ...tracks[9], uid: 11, points: tracks[9].points.map(p => ({ ...p, points: p.time >= base + 90 * 60000 ? p.points : -1 })) };
        tracks[9].points = tracks[9].points.map(p => ({ ...p, points: p.time >= base + 90 * 60000 ? -1 : p.points }));
        const row = toHourlySnapshots([...tracks, entrant])[0].rows.find(r => r.uid === 11);
        expect(row).toMatchObject({ usesTenthPlaceBaseline: true, speed: 61000, changes: null, average: null });
    });
    it("preserves zero gains, accepts seconds, and bounds event data", () => {
        const tracks = fixture().map(p => ({ ...p, points: p.points.map(s => ({ time: s.time / 1000, points: 1000 })) }));
        const result = toHourlySnapshots(tracks, base, base + 60 * 60000);
        expect(result).toHaveLength(1);
        expect(result[0].rows[0]).toMatchObject({ speed: 0, changes: 0, speedRank: null });
        expect(toHourlySnapshots([])).toEqual([]);
    });
});
