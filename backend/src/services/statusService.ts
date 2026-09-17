export type ServiceState = "operational" | "degraded" | "unknown" | "disabled";
export interface ServiceObservation {
    id: string;
    group: "core" | "game";
    status: ServiceState;
    checkedAt: number | null;
}
const definitions: Array<[string, ServiceObservation["group"]]> = [
    ["database", "core"],
];
export class StatusService {
    private observations = new Map<string, ServiceObservation>(definitions.map(([id, group]) => [id, { id, group, status: "unknown", checkedAt: null }]));

    registerGameServers(enabled: number[]): void {
        for (const task of ["availability", "eventRankingTask", "monthlyRankingTask"]) {
            for (let server = 0; server < 5; server++) {
                const id = `${task}:${server}`;
                if (!this.observations.has(id))
                    this.observations.set(id, {
                        id,
                        group: "game",
                        status: enabled.includes(server) ? "unknown" : "disabled",
                        checkedAt: null,
                    });
            }
        }
    }

    async observeTask<T>(task: string, server: number, action: () => Promise<T>): Promise<T> {
        const id = `${task}:${server}`;
        try {
            const result = await action();
            this.record(id, result === false ? "unknown" : "operational", "game");
            return result;
        } catch (error) {
            this.record(id, "degraded", "game");
            throw error;
        }
    }

    record(id: string, status: ServiceState, group: ServiceObservation["group"], now = Date.now()): void {
        const previous = this.observations.get(id);
        this.observations.set(id, { id, group: previous?.group ?? group, status, checkedAt: status === "unknown" ? null : now });
    }

    snapshot(now = Date.now()): { status: ServiceState; checkedAt: number; components: ServiceObservation[] } {
        const components = [...this.observations.values()].map((component) => ({
            ...component,
            // Passive observations expire; an idle service is not proof of health.
            status:
                component.status === "disabled"
                    ? component.status
                    : component.checkedAt === null || now - component.checkedAt > 5 * 60_000
                      ? ("unknown" as const)
                      : component.status,
        }));
        const status: ServiceState = components.some((c) => c.status === "degraded")
            ? "degraded"
            : components.some((c) => c.status === "unknown")
              ? "unknown"
              : "operational";
        return { status, checkedAt: now, components };
    }
}
export const statusService = new StatusService();
