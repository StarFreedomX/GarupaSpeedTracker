import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import Router from "@koa/router";
import { getSongMetadata } from "@/services";
import type { SongChartMeta } from "@/types/songMetadata";

const gzip = promisify(gzipCallback);

/**
 * Minimal service interface for song metadata.
 */
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

/**
 * Sends a JSON body with optional gzip compression.
 *
 * If the client accepts gzip encoding the response body is compressed and the
 * `Content-Encoding: gzip` header is set. Otherwise, the body is sent as plain JSON.
 */
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

/**
 * Creates a Koa router for the song metadata endpoint.
 *
 * Uses a dependency-injectable service so tests can provide a mock implementation.
 * Defaults to the real {@link getSongMetadata} service.
 */
export const createSongMetadataRouter = (service: SongMetadataServiceLike = { getSongMetadata }): Router => {
    const router = new Router();

    router.get("/songMetadata.json", async (ctx) => {
        const result = await service.getSongMetadata();
        ctx.status = 200;
        await sendJson(ctx, result);
    });

    return router;
};

/**
 * Pre-built song metadata router using the real song metadata service.
 */
export const songMetadataRouter = createSongMetadataRouter();
