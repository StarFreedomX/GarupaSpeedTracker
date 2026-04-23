import Router from "@koa/router";
import { getEventList } from "@/services/bestdoriService";

/**
 * Router group for Bestdori event list endpoints.
 *
 * The route keeps the response shape lightweight by forwarding only the
 * normalized event list projection produced by the service layer.
 */
export const eventRouter = new Router();

/**
 * GET /api/events
 *
 * Fetches the Bestdori event list through the service layer and returns the
 * normalized event object keyed by event ID.
 *
 * Failure semantics:
 * - Upstream failures and timeouts are handled by the global error middleware
 * - The handler itself does not accept query parameters
 *
 * @param ctx Koa request context used to send the JSON response body.
 */
eventRouter.get("/events", async (ctx) => {
    const result = await getEventList();
    ctx.status = 200;
    ctx.body = result;
});
