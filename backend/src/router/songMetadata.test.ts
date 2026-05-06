import Koa from "koa";
import request from "supertest";
import { createSongMetadataRouter } from "@/router/songMetadata";
import type { SongChartMeta } from "@/types/songMetadata";

describe("songMetadataRouter", () => {
    it("gzips JSON when the client accepts gzip", async () => {
        const dataset: SongChartMeta = {
            1: {
                22: {
                    total: 123,
                    counts: {
                        "3.0": [1, 2, 3, 4, 5, 6],
                        "3.5": [1, 2, 3, 4, 5, 6],
                        "4.0": [1, 2, 3, 4, 5, 6],
                        "4.5": [1, 2, 3, 4, 5, 6],
                        "5.0": [1, 2, 3, 4, 5, 6],
                        "5.5": [1, 2, 3, 4, 5, 6],
                        "6.0": [1, 2, 3, 4, 5, 6],
                        "6.5": [1, 2, 3, 4, 5, 6],
                        "7.0": [1, 2, 3, 4, 5, 6],
                        "7.5": [1, 2, 3, 4, 5, 6],
                        "8.0": [1, 2, 3, 4, 5, 6],
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
