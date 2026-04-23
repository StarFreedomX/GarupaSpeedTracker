import Router from "@koa/router";
import { API_PREFIX } from "@/config";
import { eventRouter } from "@/router/event";
import { pointTrackerRouter } from "@/router/pointTracker";

const router = new Router({ prefix: API_PREFIX });

router.use(pointTrackerRouter.routes(), pointTrackerRouter.allowedMethods());
router.use(eventRouter.routes(), eventRouter.allowedMethods());

export default router;
