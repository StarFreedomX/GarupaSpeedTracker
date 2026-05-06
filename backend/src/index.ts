import { createApp } from "@/app";
import { HOST, PORT } from "@/config";
import { logger } from "@/logger";
import { songMetadataService } from "@/services";

logger("mainAPI", "initializing...");

const app = createApp();

void songMetadataService.getSongMetadata().catch((error: unknown) => {
    const nodeError = error as { message?: string };
    logger("mainAPI", `song summary warmup failed: ${nodeError.message ?? "unknown error"}`);
});

app.listen(PORT, HOST, () => {
    logger("mainAPI", `listening on ${HOST}:${PORT}`);
});
