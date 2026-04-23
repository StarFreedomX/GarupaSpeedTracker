import type { Context } from "koa";

export const loggerMiddleware = async (ctx: Context, next: () => Promise<void>) => {
    const start = Date.now();
    const timeString = new Date().toLocaleTimeString("en-GB", { hour12: false });

    console.log(`[${timeString}] [Request] ${ctx.ip} ${ctx.method} ${ctx.url}`);

    await next();

    const ms = Date.now() - start;
    const size = ctx.body ? (Buffer.byteLength(JSON.stringify(ctx.body)) / 1024).toFixed(2) : 0;
    console.log(`[${timeString}] [Response] ${ctx.status} ${ms}ms ${size}KB`);
};
