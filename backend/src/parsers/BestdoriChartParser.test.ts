import { BestdoriChartParser } from "@/parsers/BestdoriChartParser";
import { downloader } from "@/storage/downloader";
import type { Chart } from "@/types/bestdori/chart";

describe("BestdoriChartParser", () => {
    jest.setTimeout(30_000);

    it("builds the expected SongSummary from the real expert chart", async () => {
        const parser = new BestdoriChartParser();
        const chart = await downloader.download<Chart>("https://bestdori.com/api/charts/1/expert.json");
        const summary = parser.buildSongSummary(1, 22, chart);

        expect(summary).toMatchObject({
            song_id: 1,
            level: 22,
            total: 459,
            counts: {
                "3.0": [11, 15, 16, 8, 9, 10],
                "3.5": [12, 18, 18, 9, 11, 12],
                "4.0": [14, 22, 20, 12, 12, 13],
                "4.5": [16, 24, 23, 12, 15, 15],
                "5.0": [18, 27, 24, 14, 16, 17],
                "5.5": [20, 30, 27, 18, 18, 17],
                "6.0": [21, 33, 30, 21, 20, 21],
                "6.5": [22, 37, 31, 24, 22, 22],
                "7.0": [23, 38, 33, 24, 23, 25],
                "7.5": [24, 41, 34, 26, 25, 28],
                "8.0": [24, 43, 36, 30, 27, 31],
            },
            hash: "5f2267f1",
        });
    });
});
