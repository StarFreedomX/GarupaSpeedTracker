import { fetchBestdoriTopPoints } from "@/api/bestdori";
import { eventRankingService } from "@/services/eventRankingService";
import { getPointTrack } from "@/services/pointsService";

jest.mock("@/api/bestdori", () => ({ fetchBestdoriTopPoints: jest.fn() }));
jest.mock("@/services/eventRankingService", () => ({ eventRankingService: { getEventTopSnapshot: jest.fn() } }));
jest.mock("@/logger", () => ({ logger: jest.fn() }));
jest.mock("@/storage/downloader", () => ({ downloader: { formatBytes: jest.fn() } }));

const start = 1800000000000;
const snapshot = (time: number) => Array.from({ length: 10 }, (_, uid) => ({ time, uid, value: uid * 100 + (time - start) / 1000 }));
const params = { server: 3, eventId: 300, interval: 60000, time: 2 };

beforeEach(() => jest.resetAllMocks());

it("uses local snapshots, preserving sampling, lookback and incremental boundaries", async () => {
    jest.mocked(eventRankingService.getEventTopSnapshot).mockResolvedValue({
        points: [0, 60000, 120000, 130000, 180000, 240000].flatMap((offset) => snapshot(start + offset)),
        users: [],
    });
    const result = await getPointTrack(params);
    expect(eventRankingService.getEventTopSnapshot).toHaveBeenCalledWith(3, 300);
    expect(result[0].points.map((point) => point.time)).toEqual([start + 130000, start + 180000, start + 240000]);
    const incremental = await getPointTrack({ ...params, lastTimeStamp: start + 180000 });
    expect(incremental[0].points.map((point) => point.time)).toEqual([start + 180000, start + 240000]);
    expect(await getPointTrack({ ...params, lastTimeStamp: start + 300000 })).toEqual([]);
    expect(fetchBestdoriTopPoints).not.toHaveBeenCalled();
});

it.each([{ points: [] }, { points: snapshot(start).slice(0, 9) }])("falls back when local snapshots are empty or incomplete", async ({ points }) => {
    jest.mocked(eventRankingService.getEventTopSnapshot).mockResolvedValue({ points, users: [] });
    jest.mocked(fetchBestdoriTopPoints).mockResolvedValue({ points: snapshot(start), users: [] });
    expect(await getPointTrack(params)).toHaveLength(10);
    expect(fetchBestdoriTopPoints).toHaveBeenCalledTimes(1);
});

it("falls back if reading the database fails", async () => {
    jest.mocked(eventRankingService.getEventTopSnapshot).mockRejectedValue(new Error("offline"));
    jest.mocked(fetchBestdoriTopPoints).mockResolvedValue({ points: snapshot(start), users: [] });
    expect(await getPointTrack(params)).toHaveLength(10);
});
