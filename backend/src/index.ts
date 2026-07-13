/**
 * GarupaSpeedTracker — Main API entry point.
 *
 * Bootstraps the Koa application, runs startup migrations, seeds historical
 * ranking data from Bestdori and the Garupa API in parallel, then starts all
 * background polling services and begins listening for HTTP requests.
 */
import { createApp } from "@/app";
import { HOST, PORT } from "@/config";
import { logger } from "@/logger";
import { migrateTimestampToTime } from "@/migrations/timestamp-to-time";
import { eventInfoService, eventRankingService, monthlyRankingInfoService, monthlyRankingService, songMetadataService } from "@/services";

logger("mainAPI", "initializing...");

const app = createApp();

(async () => {
    // 1. Startup migrations (blocks until complete)
    await migrateTimestampToTime().catch((error: unknown) => {
        const nodeError = error as { message?: string };
        logger("migration", `timestamp-to-time failed: ${nodeError.message ?? "unknown error"}`);
    });

    // 2. Bootstrap historical data in parallel (no pollers running yet, no races)
    await Promise.allSettled([eventRankingService.bootstrap(), monthlyRankingService.bootstrap(), songMetadataService.getSongMetadata()]);

    // 3. Start background pollers (now that bootstraps are complete)
    monthlyRankingInfoService.start();
    eventInfoService.start();
    eventRankingService.start();
    monthlyRankingService.start();

    // 4. Accept traffic
    app.listen(PORT, HOST, () => {
        logger("mainAPI", `listening on ${HOST}:${PORT}`);
    });
})().catch((error: unknown) => {
    const nodeError = error as { message?: string };
    logger("mainAPI", `startup failed: ${nodeError.message ?? "unknown error"}`);
    process.exit(1);
});
