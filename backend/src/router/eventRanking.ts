import Router from "@koa/router";
import { queryToNumber, queryToOptionalNumber, validationError } from "@/router/utils";
import { eventRankingService, getEventServerCount, isEventRankingBorderTier, isMusicRankingBorderTier } from "@/services/eventRankingService";

export const eventRankingRouter = new Router();

const BESTDORI_BASE = "https://bestdori.com";

// ============================================================================
// /eventtop/data — 活动 top / 歌榜 top
//   Query: server (必填), event (必填), mid (选填 — 有则歌榜 top)
// ============================================================================

eventRankingRouter.get("/eventtop/data", async (ctx) => {
    const server = queryToNumber(ctx.query.server);
    const event = queryToNumber(ctx.query.event);
    const mid = queryToOptionalNumber(ctx.query.mid);

    const rules: Record<string, { type: string; required: boolean; min: number }> = {
        server: { type: "int", required: true, min: 0 },
        event: { type: "int", required: true, min: 1 },
    };
    const params: Record<string, number | undefined> = { server, event };

    if (mid !== undefined) {
        rules.mid = { type: "int", required: true, min: 1 };
        params.mid = mid;
    }

    ctx.verifyParams(rules, params);

    const maxServerIndex = getEventServerCount() - 1;
    if (server < 0 || server > maxServerIndex) {
        throw validationError("server", `server must be between 0 and ${maxServerIndex}`);
    }

    let result: { points: unknown[]; users: unknown[] };

    if (mid !== undefined) {
        result = await eventRankingService.getMusicTopSnapshot(server, event, mid);
    } else {
        result = await eventRankingService.getEventTopSnapshot(server, event);
    }

    // Fallback: if no local data, redirect to Bestdori
    if (result.points.length === 0) {
        ctx.redirect(`${BESTDORI_BASE}${ctx.originalUrl}`);
        return;
    }

    ctx.status = 200;
    ctx.body = result;
});

// ============================================================================
// /tracker/data — 活动档线 / 歌榜档线
//   Query: server (必填), event (必填), tier (必填), mid (选填 — 有则歌榜档线)
// ============================================================================

eventRankingRouter.get("/tracker/data", async (ctx) => {
    const server = queryToNumber(ctx.query.server);
    const event = queryToNumber(ctx.query.event);
    const tier = queryToNumber(ctx.query.tier);
    const mid = queryToOptionalNumber(ctx.query.mid);

    const rules: Record<string, { type: string; required: boolean; min: number }> = {
        server: { type: "int", required: true, min: 0 },
        event: { type: "int", required: true, min: 1 },
        tier: { type: "int", required: true, min: 1 },
    };
    const params: Record<string, number | undefined> = { server, event, tier };

    if (mid !== undefined) {
        rules.mid = { type: "int", required: true, min: 1 };
        params.mid = mid;
    }

    ctx.verifyParams(rules, params);

    const maxServerIndex = getEventServerCount() - 1;
    if (server < 0 || server > maxServerIndex) {
        throw validationError("server", `server must be between 0 and ${maxServerIndex}`);
    }

    let result: { result: boolean; cutoffs: unknown[] };

    if (mid !== undefined) {
        if (!isMusicRankingBorderTier(tier)) {
            throw validationError("tier", "tier must be one of: 20,30,40,50,100,200,300,500,1000,2000,5000,10000,20000,50000,100000");
        }
        result = await eventRankingService.getMusicBorderPoints(server, event, mid, tier);
    } else {
        if (!isEventRankingBorderTier(tier)) {
            throw validationError("tier", "tier must be one of: 20,30,40,50,100,200,300,500,1000,2000,3000,4000,5000,10000,20000,30000,40000,50000,100000");
        }
        result = await eventRankingService.getEventBorderPoints(server, event, tier);
    }

    // Fallback: if no local data, redirect to Bestdori
    if (result.cutoffs.length === 0) {
        ctx.redirect(`${BESTDORI_BASE}${ctx.originalUrl}`);
        return;
    }

    ctx.status = 200;
    ctx.body = result;
});
