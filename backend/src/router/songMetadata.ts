import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import Router from "@koa/router";
import { getSongMetadata } from "@/services";
import type { SongChartMeta } from "@/types/songMetadata";

const gzip = promisify(gzipCallback);

export interface SongMetadataServiceLike {
    getSongMetadata(): Promise<SongChartMeta>;
}

type ResponseSurface = {
    acceptsEncodings(...encodings: string[]): string | false;
    set(name: string, value: string): void;
    vary(field: string): void;
    type: string;
    body: unknown;
};

const sendJson = async (ctx: ResponseSurface, body: SongChartMeta): Promise<void> => {
    const acceptsGzip = ctx.acceptsEncodings("gzip") === "gzip";
    if (acceptsGzip) {
        const buffer = await gzip(JSON.stringify(body));
        ctx.set("Content-Encoding", "gzip");
        ctx.vary("Accept-Encoding");
        ctx.type = "application/json";
        ctx.body = buffer;
        return;
    }

    ctx.type = "application/json";
    ctx.body = body;
};

export const createSongMetadataRouter = (service: SongMetadataServiceLike = { getSongMetadata }): Router => {
    const router = new Router();

    router.get("/songMetadata.json", async (ctx) => {
        const result = await service.getSongMetadata();
        ctx.status = 200;
        await sendJson(ctx, result);
    });

    return router;
};

export const songMetadataRouter = createSongMetadataRouter();
