import Router from "@koa/router";
import { queryToNumber, queryToOptionalNumber, validationError } from "@/router/utils";
import { monthlyRankingInfoService } from "@/services/monthlyRankingInfoService";
import { getCurrentMonthlyId, getMonthlyRankingServerCount, isMonthlyRankingBorderTier, monthlyRankingService } from "@/services/monthlyRankingService";

/**
 * Router for monthly ranking endpoints — info listings, top snapshots, and border point cutoffs.
 */
export const monthlyRankingRouter = new Router();

/**
 * GET /monthlyRanking/info | /monthlyRanking/info.json
 *
 * Returns the full list of monthly ranking metadata entries (IDs, dates, status).
 */
monthlyRankingRouter.get(["/monthlyRanking/info", "/monthlyRanking/info.json"], async (ctx) => {
    const result = await monthlyRankingInfoService.getMonthlyRankingInfoList();
    ctx.status = 200;
    ctx.body = result;
});

/**
 * GET /monthlyRanking/all | /monthlyRanking/all.json
 *
 * Returns the full list of monthly ranking detail entries including server-specific data.
 */
monthlyRankingRouter.get(["/monthlyRanking/all", "/monthlyRanking/all.json"], async (ctx) => {
    const result = await monthlyRankingInfoService.getMonthlyRankingDetailList();
    ctx.status = 200;
    ctx.body = result;
});

/**
 * GET /monthlyRanking/info.:monthlyRankingId.json
 *
 * Returns the detail data for a specific monthly ranking by ID.
 * Responds with 404 if the monthly ranking detail is not found.
 *
 * Path parameters:
 * - `monthlyRankingId` (required, int >= 1) — Monthly ranking identifier.
 */
monthlyRankingRouter.get("/monthlyRanking/info.:monthlyRankingId.json", async (ctx) => {
    const monthlyRankingId = queryToNumber(ctx.params.monthlyRankingId);

    ctx.verifyParams(
        {
            monthlyRankingId: { type: "int", required: true, min: 1 },
        },
        { monthlyRankingId },
    );

    const result = await monthlyRankingInfoService.getMonthlyRankingDetail(monthlyRankingId);
    if (!result) {
        ctx.status = 404;
        ctx.body = {
            status: 404,
            message: `Monthly ranking detail not found: ${monthlyRankingId}`,
        };
        return;
    }

    ctx.status = 200;
    ctx.body = result;
});

/**
 * GET /monthlyRanking/top | /monthlyRanking/top.json
 *
 * Returns the top snapshot (points + users) for a monthly ranking.
 * If `monthlyId` is omitted the current active monthly ranking is resolved automatically.
 *
 * Query parameters:
 * - `server` (required, int >= 0) — Game server index.
 * - `monthlyId` (optional, int >= 1) — Monthly ranking ID. Defaults to current.
 */
monthlyRankingRouter.get(["/monthlyRanking/top", "/monthlyRanking/top.json"], async (ctx) => {
    const server = queryToNumber(ctx.query.server);
    const monthlyId = queryToOptionalNumber(ctx.query.monthlyId);

    ctx.verifyParams(
        {
            server: { type: "int", required: true, min: 0 },
            monthlyId: { type: "int", required: false, min: 1 },
        },
        { server, monthlyId },
    );

    const maxServerIndex = getMonthlyRankingServerCount() - 1;
    if (server < 0 || server > maxServerIndex) {
        throw validationError("server", `server must be between 0 and ${maxServerIndex}`);
    }

    const resolvedMonthlyId = monthlyId ?? (await getCurrentMonthlyId(server));
    if (!resolvedMonthlyId) {
        ctx.status = 200;
        ctx.body = { points: [], users: [] };
        return;
    }

    const result = await monthlyRankingService.getTopSnapshot(server, resolvedMonthlyId);
    ctx.status = 200;
    ctx.body = result;
});

/**
 * GET /monthlyRanking/border | /monthlyRanking/border.json
 *
 * Returns border (cutoff) points for a specific monthly ranking tier.
 * If `monthlyId` is omitted the current active monthly ranking is resolved automatically.
 *
 * Query parameters:
 * - `server` (required, int >= 0) — Game server index.
 * - `monthlyId` (optional, int >= 1) — Monthly ranking ID. Defaults to current.
 * - `tier` (required, int >= 1) — Border tier. Must be one of the valid monthly ranking
 *   tiers: 20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 3000, 4000, 5000.
 */
monthlyRankingRouter.get(["/monthlyRanking/border", "/monthlyRanking/border.json"], async (ctx) => {
    const server = queryToNumber(ctx.query.server);
    const monthlyId = queryToOptionalNumber(ctx.query.monthlyId);
    const tier = queryToNumber(ctx.query.tier);

    ctx.verifyParams(
        {
            server: { type: "int", required: true, min: 0 },
            monthlyId: { type: "int", required: false, min: 1 },
            tier: { type: "int", required: true, min: 1 },
        },
        { server, monthlyId, tier },
    );

    const maxServerIndex = getMonthlyRankingServerCount() - 1;
    if (server < 0 || server > maxServerIndex) {
        throw validationError("server", `server must be between 0 and ${maxServerIndex}`);
    }

    if (!isMonthlyRankingBorderTier(tier)) {
        throw validationError("tier", "tier must be one of: 20,30,40,50,100,200,300,500,1000,2000,3000,4000,5000");
    }

    const resolvedMonthlyId = monthlyId ?? (await getCurrentMonthlyId(server));
    if (!resolvedMonthlyId) {
        ctx.status = 200;
        ctx.body = { result: true, cutoffs: [] };
        return;
    }

    const result = await monthlyRankingService.getBorderPoints(server, resolvedMonthlyId, tier);
    ctx.status = 200;
    ctx.body = result;
});
