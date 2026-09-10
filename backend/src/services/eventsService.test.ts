import { fetchBestdoriEvents } from "@/api/bestdori";
import { eventInfoService } from "@/services/eventInfoService";
import { getEventList } from "@/services/eventsService";

jest.mock("@/api/bestdori", () => ({ fetchBestdoriEvents: jest.fn() }));
jest.mock("@/services/eventInfoService", () => ({ eventInfoService: { getEventInfoList: jest.fn() } }));
jest.mock("@/logger", () => ({ logger: jest.fn() }));

const localEvent = {
    eventType: "challenge",
    eventName: [null, null, null, "新活动", null],
    assetBundleName: "new",
    bgmFileName: "",
    startAt: [null, null, null, 1789000000000, null],
    endAt: [null, null, null, 1789600000000, null],
};

beforeEach(() => jest.resetAllMocks());

it("includes database-only events and prefers local metadata without erasing other servers", async () => {
    jest.mocked(fetchBestdoriEvents).mockResolvedValue({
        "1": { eventName: ["JP", null, null, "old"], startAt: ["100", null, null, "200"] },
        "2": { eventName: ["Historical"] },
    });
    jest.mocked(eventInfoService.getEventInfoList).mockResolvedValue({ "1": localEvent, "3": localEvent });
    const result = await getEventList();
    expect(Object.keys(result)).toEqual(["1", "2", "3"]);
    expect(result["1"].eventName).toEqual(["JP", null, null, "新活动", null]);
    expect(result["1"].startAt).toEqual(["100", null, null, "1789000000000", null]);
    expect(result["3"].endAt[3]).toBe("1789600000000");
});

it("serves local events when Bestdori fails", async () => {
    jest.mocked(fetchBestdoriEvents).mockRejectedValue(new Error("offline"));
    jest.mocked(eventInfoService.getEventInfoList).mockResolvedValue({ "3": localEvent });
    expect((await getEventList())["3"].eventName[3]).toBe("新活动");
});

it("preserves Bestdori history when the database fails", async () => {
    jest.mocked(fetchBestdoriEvents).mockResolvedValue({ "2": { eventName: ["Historical"] } });
    jest.mocked(eventInfoService.getEventInfoList).mockRejectedValue(new Error("offline"));
    expect((await getEventList())["2"].eventName[0]).toBe("Historical");
});

it("propagates failure when both sources are unavailable", async () => {
    jest.mocked(fetchBestdoriEvents).mockRejectedValue(new Error("offline"));
    jest.mocked(eventInfoService.getEventInfoList).mockRejectedValue(new Error("database offline"));
    await expect(getEventList()).rejects.toThrow("database offline");
});
