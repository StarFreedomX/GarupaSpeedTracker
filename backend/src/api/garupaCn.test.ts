const mockFetch = jest.fn(async (_base: string, _version: string, urlForUser: (uid: string) => string) => ({
    decrypted: Buffer.from(urlForUser("123456")),
    status: 200,
    length: 0,
}));
jest.mock("@/config", () => ({
    ...jest.requireActual("@/config"),
    GARUPA_SERVER_BASES: ["-", "-", "-", "https://game.example/api/"],
    GARUPA_UIDS: ["-", "-", "-", "stale-uid"],
    GARUPA_CIDS: ["-", "-", "-", "1"],
    GARUPA_PIDS: ["-", "-", "-", "2"],
    GARUPA_ENCRYPTION_KEYS: ["-", "-", "-", "test-key-1234567"],
    GARUPA_ENCRYPTION_IVS: ["-", "-", "-", "test-iv--1234567"],
    GARUPA_RKEYS: ["-", "-", "-", "test-request-key"],
    GARUPA_CN_SDK_APP_KEY: "test-sdk-app-key",
}));
jest.mock("./cnSession", () => ({
    ...jest.requireActual("./cnSession"),
    CnSessionClient: jest.fn().mockImplementation(() => ({ fetch: mockFetch })),
}));

import { fetchEventRankingBuffer, fetchMonthlyRankingBuffer } from "./garupa";

test("monthly and event ranking routes use the authenticated UID instead of configured stale UID", async () => {
    const monthly = await fetchMonthlyRankingBuffer(3, 17, "9.4.4");
    expect(monthly.decrypted.toString()).toBe("https://game.example/api/user/123456/monthlyranking/17/ranking");
    const event = await fetchEventRankingBuffer(3, 316, "challenge", "9.4.4");
    expect(event.decrypted.toString()).toContain("/user/123456/event/316/");
    expect(mockFetch).toHaveBeenCalledTimes(2);
});
