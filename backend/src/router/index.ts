import Router from "@koa/router";
import { API_PREFIX } from "@/config";
import { eventRouter } from "@/router/event";
import { pointTrackerRouter } from "@/router/pointTracker";
import { songMetadataRouter } from "@/router/songMetadata";

const router = new Router({ prefix: API_PREFIX });

router.use(pointTrackerRouter.routes(), pointTrackerRouter.allowedMethods());
router.use(eventRouter.routes(), eventRouter.allowedMethods());
router.use(songMetadataRouter.routes(), songMetadataRouter.allowedMethods());

export default router;
