import Router from "@koa/router";
import { queryToNumber, queryToOptionalNumber } from "@/router/utils";
import { playerDeckService } from "@/services/playerDeckService";

export const playerDeckRouter = new Router();

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
