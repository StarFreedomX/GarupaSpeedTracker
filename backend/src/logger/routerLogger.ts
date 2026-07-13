import type { Context } from "koa";

/**
 * Koa middleware that logs every incoming HTTP request and its response.
 *
 * Logs the client IP, HTTP method, and URL on request start. After the
 * downstream middleware completes, logs the response status, elapsed time,
 * and approximate body size in KB.
 */
export const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    const start = Date.now();
    const timeString = new Date().toLocaleTimeString("en-GB", { hour12: false });

    console.log(`[${timeString}] [Request] ${ctx.ip} ${ctx.method} ${ctx.url}`);

    await next();

    const ms = Date.now() - start;
    const size = ctx.body ? (Buffer.byteLength(JSON.stringify(ctx.body)) / 1024).toFixed(2) : 0;
    console.log(`[${timeString}] [Response] ${ctx.status} ${ms}ms ${size}KB`);
};
