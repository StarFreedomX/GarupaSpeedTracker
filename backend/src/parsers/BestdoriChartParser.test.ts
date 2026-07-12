import { BestdoriChartParser } from "@/parsers/BestdoriChartParser";
import { downloader } from "@/storage/downloader";
import type { Chart } from "@/types/bestdori/chart";

describe("BestdoriChartParser", () => {
    jest.setTimeout(30_000);

    it("builds the expected level summary from the real expert chart", async () => {
        const parser = new BestdoriChartParser();
        const chart = await downloader.download<Chart>("https://bestdori.com/api/charts/1/expert.json");
        const levelSummary = parser.buildLevelSummary(chart, 22);

        expect(levelSummary).toMatchObject({
            level: 22,
            total: 459,
            counts: {
                "3.0": [11, 15, 16, 8, 9, 10],
                "3.7": [12.125, 20, 18, 9, 11, 12],
                "4.2": [14.125, 24, 21, 12, 13.0625, 13],
                "5.0": [18, 27, 24, 14, 16.0625, 17],
                "5.5": [20, 30.0625, 27.0625, 18, 18.0625, 19],
                "7.0": [23, 38, 33, 24, 23, 25],
                "7.6": [24, 41, 34, 26, 25, 28.0625],
                "8.0": [24, 43, 36, 30, 27, 31],
            },
        });
    });
});
