/**
 * GarupaSpeedTracker — Main API entry point.
 *
 * Bootstraps the Koa application, warms up song metadata, starts all background
 * services (monthly ranking, event info, event ranking), and begins listening
 * for HTTP requests on the configured host and port.
 */
import { createApp } from "@/app";
import { HOST, PORT } from "@/config";
import { logger } from "@/logger";
import { eventInfoService, eventRankingService, monthlyRankingInfoService, monthlyRankingService, songMetadataService } from "@/services";

logger("mainAPI", "initializing...");

const app = createApp();

void songMetadataService.getSongMetadata().catch((error: unknown) => {
    const nodeError = error as { message?: string };
    logger("mainAPI", `song summary warmup failed: ${nodeError.message ?? "unknown error"}`);
});

monthlyRankingInfoService.start();
monthlyRankingService.start();
eventInfoService.start();
eventRankingService.start();

app.listen(PORT, HOST, () => {
    logger("mainAPI", `listening on ${HOST}:${PORT}`);
});
