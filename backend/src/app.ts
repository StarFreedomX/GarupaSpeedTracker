import Koa from "koa";
import parameter from "koa-parameter";
import { APP_PROXY, ENABLE_CORS } from "@/config";
import { loggerMiddleware } from "@/logger/routerLogger";
import { corsMiddleware } from "@/middleware/cors";
import router from "@/router";
import { errorHandlerMiddleware } from "@/router/middleware";

export const createApp = (): Koa => {
    const app = new Koa();
    app.proxy = APP_PROXY;

    parameter(app);
    if (ENABLE_CORS) {
        app.use(corsMiddleware);
    }
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
