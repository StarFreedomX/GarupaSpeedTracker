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
    // 1. Accept traffic immediately — independent endpoints (e.g. SongMetadata) work right away
    app.listen(PORT, HOST, () => {
        logger("mainAPI", `listening on ${HOST}:${PORT}`);
    });

    // 2. Run startup migrations in background (may block if DB unavailable; non-fatal)
    migrateTimestampToTime().catch((error: unknown) => {
        const nodeError = error as { message?: string };
        logger("migration", `timestamp-to-time failed: ${nodeError.message ?? "unknown error"}`);
    });

    // 3. Bootstrap historical data in parallel (may block if DB unavailable; non-fatal)
    await Promise.allSettled([eventRankingService.bootstrap(), monthlyRankingService.bootstrap(), songMetadataService.getSongMetadata()]);

    // 4. Start background pollers
    monthlyRankingInfoService.start();
    eventInfoService.start();
    eventRankingService.start();
    monthlyRankingService.start();
})().catch((error: unknown) => {
    const nodeError = error as { message?: string };
    logger("mainAPI", `startup failed: ${nodeError.message ?? "unknown error"}`);
    process.exit(1);
});
