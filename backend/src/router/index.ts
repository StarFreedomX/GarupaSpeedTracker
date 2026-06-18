import Router from "@koa/router";
import { API_PREFIX } from "@/config";
import { eventRouter } from "@/router/event";
import { monthlyRankingRouter } from "@/router/monthlyRanking";
import { playerDeckRouter } from "@/router/playerDeck";
import { pointTrackerRouter } from "@/router/pointTracker";
import { songMetadataRouter } from "@/router/songMetadata";
import { songsRouter } from "@/router/songs";

const router = new Router({ prefix: API_PREFIX });

router.use(pointTrackerRouter.routes(), pointTrackerRouter.allowedMethods());
router.use(eventRouter.routes(), eventRouter.allowedMethods());
router.use(songsRouter.routes(), songsRouter.allowedMethods());
router.use(songMetadataRouter.routes(), songMetadataRouter.allowedMethods());
router.use(monthlyRankingRouter.routes(), monthlyRankingRouter.allowedMethods());
router.use(playerDeckRouter.routes(), playerDeckRouter.allowedMethods());

export default router;
