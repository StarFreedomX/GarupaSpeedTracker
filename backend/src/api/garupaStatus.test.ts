const mockDownloadRaw = jest.fn();

jest.mock("@/config", () => ({
    ...jest.requireActual("@/config"),
    GARUPA_SERVER_BASES: ["https://game.example/api/"],
    GARUPA_USER_AGENTS: ["test-agent"],
    GARUPA_UNITY_VERSIONS: ["test-unity"],
    GARUPA_CLIENT_PLATFORMS: ["Android"],
    GARUPA_UUIDS: ["test-signature"],
    GARUPA_CIDS: ["-"],
    GARUPA_PIDS: ["-"],
}));
jest.mock("@/storage/downloader", () => ({ downloader: { downloadRaw: mockDownloadRaw } }));

import { waitUntilGarupaAvailable } from "./garupa";

afterEach(() => {
    jest.useRealTimers();
    mockDownloadRaw.mockReset();
});

test.each([426, 511] as const)("recovery refreshes the client version after HTTP %i", async (status) => {
    jest.useFakeTimers();
    let version = "9.4.4";
    mockDownloadRaw.mockImplementation(async (_url: string, headers: Record<string, string>) => ({
        status: headers["X-ClientVersion"] === "10.1.3" ? 200 : status,
        body: Buffer.alloc(0),
        headers: {},
    }));
    let refreshCount = 0;
    const refreshVersion = jest.fn(async () => {
        refreshCount++;
        if (refreshCount === 2) version = "10.1.3";
    });

    const recovery = waitUntilGarupaAvailable(0, () => version, 1000, 2000, refreshVersion);
    await jest.advanceTimersByTimeAsync(2000);
    await recovery;

    expect(refreshVersion).toHaveBeenCalledTimes(2);
    expect(refreshVersion).toHaveBeenCalledWith(status);
    expect(mockDownloadRaw.mock.calls.map(([, headers]) => headers["X-ClientVersion"])).toEqual(["9.4.4", "9.4.4", "10.1.3"]);
});

test("recovery does not refresh the client version for other HTTP errors", async () => {
    jest.useFakeTimers();
    mockDownloadRaw.mockResolvedValueOnce({ status: 503, body: Buffer.alloc(0), headers: {} });
    mockDownloadRaw.mockResolvedValueOnce({ status: 200, body: Buffer.alloc(0), headers: {} });
    const refreshVersion = jest.fn();

    const recovery = waitUntilGarupaAvailable(0, () => "9.4.4", 1000, 2000, refreshVersion);
    await jest.advanceTimersByTimeAsync(1000);
    await recovery;

    expect(refreshVersion).not.toHaveBeenCalled();
    expect(mockDownloadRaw).toHaveBeenCalledTimes(2);
});
