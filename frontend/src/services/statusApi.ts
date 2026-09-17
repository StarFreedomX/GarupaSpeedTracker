import { getApiBase } from "@/services/apiBase";
export type ServiceState = "operational" | "degraded" | "unknown" | "disabled";
export interface StatusSnapshot {
    status: ServiceState;
    checkedAt: number;
    components: Array<{ id: string; group: "core" | "game"; status: ServiceState; checkedAt: number | null }>;
}
export async function fetchServiceStatus(signal: AbortSignal): Promise<StatusSnapshot> {
    const response = await fetch(`${getApiBase()}/status`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
    const data = await response.json();
    const states = ["operational", "degraded", "unknown", "disabled"];
    if (
        !data ||
        !states.includes(data.status) ||
        !Number.isFinite(data.checkedAt) ||
        !Array.isArray(data.components) ||
        data.components.length === 0 ||
        !data.components.every(
            (c: StatusSnapshot["components"][number]) =>
                c &&
                typeof c.id === "string" &&
                ["core", "game"].includes(c.group) &&
                states.includes(c.status) &&
                (c.checkedAt === null || Number.isFinite(c.checkedAt)),
        )
    ) {
        throw new Error("Invalid status response");
    }
    return data;
}
