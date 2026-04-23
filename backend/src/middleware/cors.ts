import type { Context, Next } from "koa";

const ALLOW_HEADERS = "Content-Type, Accept, Origin, X-Requested-With, Authorization";
const ALLOW_METHODS = "GET, OPTIONS";

export const corsMiddleware = async (ctx: Context, next: Next): Promise<void> => {
    const origin = ctx.get("Origin");

    if (origin) {
        ctx.set("Access-Control-Allow-Origin", origin);
        ctx.set("Vary", "Origin");
    } else {
        ctx.set("Access-Control-Allow-Origin", "*");
    }

    ctx.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    ctx.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
    ctx.set("Access-Control-Max-Age", "86400");

    if (ctx.method === "OPTIONS") {
        ctx.status = 204;
        return;
    }

    await next();
};
