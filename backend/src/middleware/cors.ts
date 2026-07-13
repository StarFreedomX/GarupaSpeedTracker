import type { Context, Next } from "koa";

const ALLOW_HEADERS = "Content-Type, Accept, Origin, X-Requested-With, Authorization";
const ALLOW_METHODS = "GET, OPTIONS";

/**
 * Koa middleware that adds CORS headers to every response.
 *
 * Sets `Access-Control-Allow-Origin` to the request's `Origin` header (mirroring)
 * or `*` when no origin is present. Preflight `OPTIONS` requests receive a 204
 * status without further processing.
 *
 * Allowed methods: GET, OPTIONS.
 * Allowed headers: Content-Type, Accept, Origin, X-Requested-With, Authorization.
 * Max age: 24 hours.
 */
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
