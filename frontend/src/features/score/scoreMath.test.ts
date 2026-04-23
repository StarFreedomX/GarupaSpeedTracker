import { describe, expect, it } from "vitest";
import { toTableModel } from "@/features/score/scoreMath";
import type { PlayerTrack } from "@/types/score";

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
