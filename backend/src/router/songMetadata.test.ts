import Koa from "koa";
import request from "supertest";
import { createSongMetadataRouter } from "@/router/songMetadata";
import type { SongChartMeta } from "@/types/songMetadata";

describe("songMetadataRouter", () => {
    it("gzips JSON when the client accepts gzip", async () => {
        const dataset: SongChartMeta = {
            1: {
                "0": {
                    level: 5,
                    total: 63,
                    counts: {
                        "3.0": [1, 1, 1, 1, 1, 2],
                        "3.5": [1, 1, 1, 1, 1, 3],
                        "4.0": [1, 1, 1, 1, 1, 4],
                        "4.5": [1, 1, 1, 1, 1, 4],
                        "5.0": [1, 1, 1, 1, 1, 4],
                        "5.5": [2, 2, 2, 2, 2, 4],
                        "6.0": [2, 2, 2, 2, 2, 6],
                        "6.5": [3, 2, 3, 2, 3, 7],
                        "7.0": [3, 4, 3, 2, 3, 7],
                        "7.5": [3, 4, 3, 2, 3, 7],
                        "8.0": [3, 4, 3, 3, 4, 8],
                    },
                },
                "1": {
                    level: 10,
                    total: 153,
                    counts: {
                        "3.0": [6, 4, 4, 2, 2, 8],
                        "3.5": [6, 5, 4, 2, 3, 10],
                        "4.0": [9, 6, 5, 3, 3, 11],
                        "4.5": [9, 6, 5, 3, 3, 13],
                        "5.0": [10, 7, 5, 3, 4, 15],
                        "5.5": [12, 9, 6, 4, 4, 15],
                        "6.0": [14, 9, 6, 4, 5, 18],
                        "6.5": [17, 9, 7, 5, 5, 19],
                        "7.0": [17, 10, 7, 5, 5, 19],
                        "7.5": [18, 10, 7, 5, 6, 20],
                        "8.0": [18, 10, 9, 6, 6, 20],
                    },
                },
                "2": {
                    level: 17,
                    total: 336,
                    counts: {
                        "3.0": [8, 7, 9, 8, 9, 9],
                        "3.5": [8, 7, 11, 11, 11, 11],
                        "4.0": [11, 9, 12, 11, 13, 12],
                        "4.5": [11, 10, 14, 13, 15, 14],
                        "5.0": [12, 13, 16, 15, 15, 16],
                        "5.5": [14, 17, 18, 16, 17, 16],
                        "6.0": [16, 18, 21, 19, 19, 19],
                        "6.5": [19, 20, 22, 19, 21, 19],
                        "7.0": [19, 21, 24, 21, 21, 20],
                        "7.5": [20, 23, 25, 23, 23, 21],
                        "8.0": [20, 26, 27, 24, 24, 21],
                    },
                },
                "3": {
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
                },
                "4": {
                    level: 26,
                    total: 832,
                    counts: {
                        "3.0": [21, 29, 23, 24, 26, 22],
                        "3.5": [24, 33, 27, 29, 29, 26],
                        "4.0": [28, 36, 30, 33, 33, 30],
                        "4.5": [32, 39, 35, 37, 38, 33],
                        "5.0": [35, 42, 39, 41, 41, 37],
                        "5.5": [37, 45, 43, 44, 45, 40],
                        "6.0": [41, 49, 48, 49, 49, 45],
                        "6.5": [44, 52, 50, 53, 54, 49],
                        "7.0": [47, 55, 54, 57, 57, 53],
                        "7.5": [50, 59, 56, 61, 61, 57],
                        "8.0": [54, 62, 60, 64, 64, 60],
                    },
                },
            },
        };
        const app = new Koa();
        const router = createSongMetadataRouter({ getSongMetadata: async () => dataset });
        app.use(router.routes());
        app.use(router.allowedMethods());

        const response = await request(app.callback())
            .get("/songMetadata.json")
            .set("Accept-Encoding", "gzip")
            .buffer(true)
            .parse((res, cb) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                res.on("end", () => cb(null, Buffer.concat(chunks)));
            });

        expect(response.status).toEqual(200);
        expect(response.headers["content-encoding"]).toEqual("gzip");
        expect(JSON.parse(response.body.toString("utf8"))).toEqual(dataset);
    });
});
