import { BestdoriPointsParser } from "./BestdoriPointsParser";

const start = 1800000000000;
const first = [1, 2, 3, 8543205, 1214996, 6, 7, 8, 9, 10];
const second = [1, 2, 3, 1214996, 8543205, 6, 7, 8, 9, 10];
const snapshot = (uids: number[], time: number) => uids.map((uid, index) => ({
    time, uid, value: index === 3 || index === 4 ? 5300530 : (10 - index) * 1000000,
}));

describe("original snapshot ranking", () => {
    const parser = new BestdoriPointsParser();
    it("preserves the TW 327 tied T4/T5 order instead of sorting by UID", () => {
        const result = parser.buildPointTrack({ points: snapshot(first, start), users: [] }, 60);
        expect(result.slice(3, 5).map(player => player.uid)).toEqual([8543205, 1214996]);
        expect(result[3].points[0]).toEqual({ time: start, points: 5300530, rank: 4 });
    });
    it("uses each snapshot's order, including changes and incremental responses", () => {
        const payload = { points: [...snapshot(first, start), ...snapshot(second, start + 60000)], users: [] };
        const result = parser.buildPointTrack(payload, 60);
        expect(result.slice(3, 5).map(player => player.uid)).toEqual([1214996, 8543205]);
        expect(result.find(player => player.uid === 8543205)?.points.map(point => point.rank)).toEqual([4, 5]);
        const incremental = parser.buildPointTrack(payload, 60, start + 60000);
        expect(incremental[3].points).toEqual([{ time: start + 60000, points: 5300530, rank: 4 }]);
    });
});
