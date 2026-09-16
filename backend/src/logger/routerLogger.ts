import type { Context } from "koa";
import { logger } from "@/logger";

/**
 * Koa middleware that logs every incoming HTTP request and its response.
 *
 * Logs the client IP, HTTP method, and URL on request start. After the
 * downstream middleware completes, logs the response status, elapsed time,
 * and approximate body size in KB.
 */
export const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    const start = Date.now();

    logger("Request", `${ctx.ip} ${ctx.method} ${ctx.url}`);

    await next();

    const ms = Date.now() - start;
    const size = ctx.body ? (Buffer.byteLength(JSON.stringify(ctx.body)) / 1024).toFixed(2) : 0;
    logger("Response", `${ctx.status} ${ms}ms ${size}KB`, ctx.status >= 500 ? "error" : ctx.status >= 400 ? "warn" : "success");
};
