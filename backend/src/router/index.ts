import Router from "@koa/router";
import { API_PREFIX } from "@/config";
import { eventRouter } from "@/router/event";
import { eventRankingRouter } from "@/router/eventRanking";
import { monthlyRankingRouter } from "@/router/monthlyRanking";
import { playerDeckRouter } from "@/router/playerDeck";
import { pointTrackerRouter } from "@/router/pointTracker";
import { songMetadataRouter } from "@/router/songMetadata";
import { songsRouter } from "@/router/songs";

/**
 * Aggregated Koa router that mounts all sub-routers under the {@link API_PREFIX}.
 *
 * Sub-routers are registered in the following order:
 * 1. point tracker
 * 2. events
 * 3. songs
 * 4. song metadata
 * 5. monthly ranking
 * 6. event ranking
 * 7. player deck
 */
const router = new Router({ prefix: API_PREFIX });

router.use(pointTrackerRouter.routes(), pointTrackerRouter.allowedMethods());
router.use(eventRouter.routes(), eventRouter.allowedMethods());
router.use(songsRouter.routes(), songsRouter.allowedMethods());
router.use(songMetadataRouter.routes(), songMetadataRouter.allowedMethods());
router.use(monthlyRankingRouter.routes(), monthlyRankingRouter.allowedMethods());
router.use(eventRankingRouter.routes(), eventRankingRouter.allowedMethods());
router.use(playerDeckRouter.routes(), playerDeckRouter.allowedMethods());

export default router;
