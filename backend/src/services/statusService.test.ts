import { StatusService } from "@/services/statusService";

describe("service status", () => {
    it("keeps unobserved and expired services unknown", () => {
        const service = new StatusService();
        expect(service.snapshot(1000).components.every((c) => c.status === "unknown")).toBe(true);
        service.record("database", "operational", "core", 1000);
        expect(service.snapshot(1001).components.find((c) => c.id === "database")?.status).toBe("operational");
        expect(service.snapshot(301001).components.find((c) => c.id === "database")?.status).toBe("unknown");
    });

    it("reports failures and recovery without claiming unobserved services are healthy", () => {
        const service = new StatusService();
        service.record("availability:0", "degraded", "game", 1000);
        expect(service.snapshot(1001).status).toBe("degraded");
        service.record("availability:0", "operational", "game", 1002);
        expect(service.snapshot(1003).status).toBe("unknown");
        expect(service.snapshot(1003).components.find((c) => c.id === "availability:0")?.status).toBe("operational");
    });

    it("only exposes backend dependencies and game tasks", () => {
        const service = new StatusService();
        service.registerGameServers([3]);
        const components = service.snapshot().components;
        expect(components).toHaveLength(16);
        expect(components.every(c => c.group === "core" || c.group === "game")).toBe(true);
        expect(components.filter(c => c.group === "core").map(c => c.id)).toEqual(["database"]);
    });

});

describe("game task status", () => {
    it("lists all regions and distinguishes disabled regions from unobserved tasks", () => {
        const service = new StatusService();
        service.registerGameServers([3]);
        const components = service.snapshot().components;
        expect(components.find((c) => c.id === "eventRankingTask:3")?.status).toBe("unknown");
        expect(components.find((c) => c.id === "eventRankingTask:0")?.status).toBe("disabled");
        expect(components.some((c) => c.id === "backend")).toBe(false);
    });

    it("records collection success without changing other task/region states", async () => {
        const service = new StatusService();
        service.registerGameServers([0, 3]);
        await service.observeTask("eventRankingTask", 3, async () => 123);
        const state = (id: string) => service.snapshot().components.find((c) => c.id === id)?.status;
        expect(state("eventRankingTask:3")).toBe("operational");
        expect(state("eventRankingTask:0")).toBe("unknown");
        expect(state("monthlyRankingTask:3")).toBe("unknown");
        expect(state("availability:3")).toBe("unknown");
        service.registerGameServers([0, 3]);
        expect(state("eventRankingTask:3")).toBe("operational");
    });

    it("preserves errors and records recovery only for the affected task", async () => {
        const service = new StatusService();
        const error = new Error("upstream failure");
        await expect(
            service.observeTask("monthlyRankingTask", 3, async () => {
                throw error;
            }),
        ).rejects.toBe(error);
        service.record("database", "operational", "core");
        expect(service.snapshot().components.find((c) => c.id === "monthlyRankingTask:3")?.status).toBe("degraded");
        await service.observeTask("monthlyRankingTask", 3, async () => undefined);
        expect(service.snapshot().components.find((c) => c.id === "monthlyRankingTask:3")?.status).toBe("operational");
    });

    it("does not report a skipped collection as successful", async () => {
        const service = new StatusService();
        await service.observeTask("eventRankingTask", 3, async () => false);
        expect(service.snapshot().components.find((c) => c.id === "eventRankingTask:3")?.status).toBe("unknown");
    });
});


describe("status response timestamp", () => {
    it("always timestamps the response even when services have never run or have expired", () => {
        const service = new StatusService();
        service.registerGameServers([3]);
        const initial = service.snapshot(1000);
        expect(initial.status).toBe("unknown");
        expect(initial.checkedAt).toBe(1000);
        expect(initial.components.find(c => c.id === "database")?.checkedAt).toBeNull();
        service.record("database", "operational", "core", 1000);
        const expired = service.snapshot(301001);
        expect(expired.status).toBe("unknown");
        expect(expired.checkedAt).toBe(301001);
        expect(expired.components.find(c => c.id === "database")?.checkedAt).toBe(1000);
    });
});
