import Router from "@koa/router";
import { getSongMetadata } from "@/services/songMetadataService";
import type { SongChartMeta } from "@/types/songMetadata";

/**
 * Minimal service interface for song metadata.
 */
export interface SongMetadataServiceLike {
    getSongMetadata(): Promise<SongChartMeta>;
}

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
        ctx.body = result;
    });

    return router;
};

/**
 * Pre-built song metadata router using the real song metadata service.
 */
export const songMetadataRouter = createSongMetadataRouter();
