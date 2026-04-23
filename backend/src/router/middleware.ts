import type { Context, Next } from "koa";
import { logger } from "@/logger";

/** Global error handler for parameter validation and upstream failures. */
export const errorHandlerMiddleware = async (ctx: Context, next: Next): Promise<void> => {
    try {
        await next();
    } catch (error: unknown) {
        const err = error as { status?: number; message?: string; errors?: unknown; code?: string };

        if (err.status === 422) {
            logger("validation", `422 ${ctx.method} ${ctx.url} details=${JSON.stringify(err.errors ?? [])}`);
            ctx.status = 422;
            ctx.body = {
                status: 422,
                message: "Validation Failed",
                details: err.errors ?? [],
            };
            return;
        }

        const status = err.status ?? 500;
        logger("error", `${status} ${ctx.method} ${ctx.url} ${err.message ?? "Unknown error"}`);

        ctx.status = status;
        ctx.body = {
            status,
            message: status >= 500 ? "Internal Server Error" : (err.message ?? "Request Failed"),
        };
    }
};
