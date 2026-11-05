import Koa from "koa";
import parameter from "koa-parameter";
import { APP_PROXY, ENABLE_CORS } from "@/config";
import { loggerMiddleware } from "@/logger/routerLogger";
import { responseCompression } from "@/middleware/compression";
import { corsMiddleware } from "@/middleware/cors";
import router from "@/router";
import { errorHandlerMiddleware } from "@/router/middleware";

/**
 * Creates and configures a new Koa application instance.
 *
 * Middleware is registered in the following order:
 * 1. `koa-parameter` — query/path parameter validation.
 * 2. CORS (conditional on {@link ENABLE_CORS}).
 * 3. Brotli/gzip response compression.
 * 4. Error handler — catches and formats unhandled exceptions.
 * 5. Request/response logger.
 * 6. API router (mounted at {@link API_PREFIX}).
 * 7. Catch-all 404 handler.
 *
 * Proxy mode is enabled when {@link APP_PROXY} is true.
 */
export const createApp = (): Koa => {
    const app = new Koa();
    app.proxy = APP_PROXY;

    parameter(app);
    if (ENABLE_CORS) {
        app.use(corsMiddleware);
    }
    app.use(responseCompression);
    app.use(errorHandlerMiddleware);
    app.use(loggerMiddleware);
    app.use(router.routes());
    app.use(router.allowedMethods());
    app.use(async (ctx) => {
        ctx.status = 404;
        ctx.body = {
            status: 404,
            message: `Route Not Found: ${ctx.method} ${ctx.path}`,
        };
    });

    return app;
};
