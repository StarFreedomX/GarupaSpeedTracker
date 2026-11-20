const mockFindOne = jest.fn();

jest.mock("@/storage/dataBaseAdapter/mongodb", () => ({
    database: { collection: () => ({ findOne: mockFindOne }) },
}));
jest.mock("@/services/garupaService", () => ({
    garupaService: { start: jest.fn(), getServerCount: () => 4 },
}));

import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import Router from "@koa/router";
import Koa from "koa";
import parameter from "koa-parameter";
import { eventRankingRouter } from "@/router/eventRanking";

const app = new Koa();
parameter(app);
const router = new Router({ prefix: "/api" });
router.use(eventRankingRouter.routes());
const dispatch = router.routes();

const path = "/api/tracker/data?server=3&event=322&tier=400";

const requestBorder = async () => {
    const request = new IncomingMessage(new Socket());
    request.method = "GET";
    request.url = path;
    const context = Object.assign(app.createContext(request, new ServerResponse(request)), { params: {}, router });
    await dispatch(context, async () => {});
    return context;
};

it("serves stored CN event cutoffs for tier 400", async () => {
    const result = { result: true, cutoffs: [{ time: 1789100000000, ep: 123456 }] };
    mockFindOne.mockResolvedValueOnce(result);

    const context = await requestBorder();

    expect(context.status).toBe(200);
    expect(context.body).toEqual(result);
    expect(mockFindOne).toHaveBeenCalledWith({ server: 3, eventId: 322, tier: 400 });
});

it("redirects CN event tier 400 to Bestdori when no local data exists", async () => {
    mockFindOne.mockResolvedValueOnce(undefined);

    const context = await requestBorder();

    expect(context.status).toBe(302);
    expect(context.response.get("Location")).toBe(`https://bestdori.com${path}`);
});
