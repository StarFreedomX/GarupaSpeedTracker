import Router from "@koa/router";
import { queryToNumber, queryToOptionalNumber } from "@/router/utils";
import { playerDeckService } from "@/services/playerDeckService";

/**
 * Router for player deck status endpoint.
 */
export const playerDeckRouter = new Router();

/**
 * GET /playerDeckStatus
 *
 * Returns the deck status for a specific player, optionally filtered by event.
 *
 * Query parameters:
 * - `server` (required, int 0-4) — Game server index.
 * - `playerId` (required, int >= 1) — Player identifier.
 * - `eventId` (optional, int) — Event ID to filter by. 0 or empty is treated as unset.
 */
playerDeckRouter.get("/playerDeckStatus", async (ctx) => {
    const server = queryToNumber(ctx.query.server);
    const playerId = queryToNumber(ctx.query.playerId);
    const rawEventId = queryToOptionalNumber(ctx.query.eventId);
    const eventId = rawEventId != null && rawEventId > 0 ? rawEventId : null;

    // 仅校验必需参数；eventId 可选，0 或空均视为不传
    ctx.verifyParams(
        {
            server: { type: "int", required: true, min: 0, max: 4 },
            playerId: { type: "int", required: true, min: 1 },
        },
        { server, playerId },
    );

    const result = await playerDeckService.getPlayerDeckStatus(server, playerId, eventId);
    ctx.status = 200;
    ctx.body = result;
});
