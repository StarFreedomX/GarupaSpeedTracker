import Router from "@koa/router";
import { getGarupaServerIds } from "@/api/garupa";
import { statusService } from "@/services/statusService";
import { database } from "@/storage/dataBaseAdapter/mongodb";

export const statusRouter = new Router();
statusRouter.get("/status", (ctx) => {
    statusService.registerGameServers(getGarupaServerIds());
    statusService.record("database", database.isConnected() ? "operational" : "degraded", "core");
    ctx.set("Cache-Control", "no-store");
    ctx.body = statusService.snapshot();
});
