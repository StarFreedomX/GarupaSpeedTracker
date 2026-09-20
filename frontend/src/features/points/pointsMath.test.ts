import { describe, expect, it } from "vitest";
import { mergeTracks, toTableModel } from "@/features/points/pointsMath";
import type { PlayerTrack } from "@/types/points";

describe("toTableModel", () => {
    it("computes fallback delta with parentheses when previous timestamp is missing", () => {
        const tracks: PlayerTrack[] = [
            {
                uid: 1,
                info: { name: "A", introduction: "" },
                points: [
                    { time: 1000, points: 100 },
                    { time: 2000, points: -1 },
                    { time: 3000, points: 160 },
                ],
            },
        ];

        const table = toTableModel(tracks);
        const row3000 = table.rows.find((row) => row.time === 3000);

        expect(row3000?.cells[1].display).toBe("(60)");
    });
});

describe("tied player order", () => {
    const track = (uid: number, rank?: number, time = 1800000000000): PlayerTrack => ({
        uid, info: { name: String(uid), introduction: "" }, points: [{ time, points: 5300530, rank }],
    });
    it("uses source rank and preserves incoming order for legacy points", () => {
        expect(toTableModel([track(1214996, 5), track(8543205, 4)]).players.map(p => p.uid)).toEqual([8543205, 1214996]);
        expect(toTableModel([track(8543205), track(1214996)]).players.map(p => p.uid)).toEqual([8543205, 1214996]);
    });
    it("retains historical ranks and applies rank updates during incremental merges", () => {
        const current = [track(8543205, 4), track(1214996, 5)];
        const incoming = [track(1214996, 4, 1800000060000), track(8543205, 5, 1800000060000)];
        const merged = mergeTracks(current, incoming);
        expect(merged[0].points.map(p => p.rank)).toEqual([4, 5]);
        expect(toTableModel(merged).players.map(p => p.uid)).toEqual([1214996, 8543205]);
        const corrected = mergeTracks(merged, [track(8543205, 4, 1800000060000), track(1214996, 5, 1800000060000)]);
        expect(corrected[0].points).toHaveLength(2);
        expect(toTableModel(corrected).players.map(p => p.uid)).toEqual([8543205, 1214996]);
    });
});
