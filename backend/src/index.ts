import { createApp } from "@/app";
import { HOST, PORT } from "@/config";
import { logger } from "@/logger";

logger("mainAPI", "initializing...");

const app = createApp();

app.listen(PORT, HOST, () => {
    logger("mainAPI", `listening on ${HOST}:${PORT}`);
});
