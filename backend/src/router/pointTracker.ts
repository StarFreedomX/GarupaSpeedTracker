import Router from "@koa/router";
import { DEFAULT_INTERVAL } from "@/config";
import { isServer, queryToNumber, queryToOptionalNumber, validationError } from "@/router/utils";
import { getScoreTrack } from "@/services/bestdoriService";
import type { ScoreQueryParams } from "@/types/bestdori";

/**
 * Router group for Bestdori score tracking endpoints.
 *
 * This router validates score polling parameters, enforces the local server
 * index contract, and delegates the upstream fetch/caching work to the service
 * layer.
 */
export const pointTrackerRouter = new Router();

/**
 * GET /api/scores
 *
 * Accepts the local numeric server index plus the event/time window parameters,
 * validates them, and returns aligned score tracks for the requested event.
 *
 * Query semantics:
 * - `server` must be an integer in the range 0..4
 * - `event` must be a positive integer
 * - `interval` is optional and falls back to `DEFAULT_INTERVAL`
 * - `time` controls the lookback window in minutes
 * - `lastTimeStamp` is optional and enables incremental sync
 *
 * Failure semantics:
 * - Invalid inputs throw a 422 validation error
 * - Upstream failures are handled by the global error middleware
 *
 * @param ctx Koa request context used to read query parameters and write the response body.
 */
pointTrackerRouter.get("/scores", async (ctx) => {
    const lastTimeStamp = queryToOptionalNumber(ctx.query.lastTimeStamp);

    const validatedParams: Record<string, number> = {
        server: queryToNumber(ctx.query.server),
        event: queryToNumber(ctx.query.event),
        interval: queryToOptionalNumber(ctx.query.interval) ?? DEFAULT_INTERVAL,
        time: queryToNumber(ctx.query.time),
    };

    if (lastTimeStamp !== undefined) {
        validatedParams.lastTimeStamp = lastTimeStamp;
    }

    ctx.verifyParams(
        {
            server: { type: "int", required: true, min: 0, max: 4 },
            event: { type: "int", required: true, min: 1 },
            interval: { type: "int", required: false, min: 1 },
            time: { type: "int", required: true, min: 2 },
            lastTimeStamp: { type: "int", required: false, min: 0 },
        },
        validatedParams,
    );

    if (!isServer(validatedParams.server)) {
        throw validationError("server", "server must be one of 0,1,2,3,4");
    }

    const params: ScoreQueryParams = {
        server: validatedParams.server,
        eventId: validatedParams.event,
        interval: validatedParams.interval,
        time: validatedParams.time,
        lastTimeStamp,
    };

    const result = await getScoreTrack(params);
    ctx.status = 200;
    ctx.body = result;
});
