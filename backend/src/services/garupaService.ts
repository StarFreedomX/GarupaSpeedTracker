import { compareVersions } from "compare-versions";
import {
    checkGarupaGameStatus,
    getGarupaFallbackClientVersion,
    getGarupaPackageUrl,
    getGarupaServerCount,
    getGarupaServerIds,
    getGarupaStatusPollIntervalMs,
    getGarupaStatusUnavailabilityThreshold,
    getGarupaVersionCheckTimeoutMs,
    waitUntilGarupaAvailable,
} from "@/api/garupa";
import { GARUPA_REFRESH_AT_SECOND, GARUPA_REFRESH_INTERVAL_SECONDS, MONGODB_GARUPA_META_COLLECTION } from "@/config";
import { logger } from "@/logger";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { GarupaMetaDocument } from "@/types/garupaMeta";

export interface GarupaServerStatus {
    available: boolean;
    disabled: boolean;
    unavailabilityCount: number;
    thresholdReached: boolean;
}

const garupaMetaCollection = database.collection<GarupaMetaDocument>(MONGODB_GARUPA_META_COLLECTION);

class GarupaService {
    private refreshTimeout: NodeJS.Timeout | undefined;
    private refreshInterval: NodeJS.Timeout | undefined;
    private started = false;
    private initTask: Promise<void> | undefined;
    private serverClientVersions = new Map<number, string>();
    private unavailabilityCounts = new Map<number, number>();
    private disabledServers = new Set<number>();
    private recoveryInFlight = new Map<number, Promise<void>>();
    private versionRefreshInFlight = new Map<number, Promise<void>>();
    private pollers = new Map<string, { fn: () => Promise<void>; intervalMs: number; lastRun: number }>();

    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;

        for (let i = 0; i < getGarupaServerCount(); i++) {
            if (!this.unavailabilityCounts.has(i)) {
                this.unavailabilityCounts.set(i, 0);
            }
        }

        void this.initializeClientVersions().catch((err) => logger("garupaService", `client version init failed: ${String(err)}`));
        void this.initializeClientVersions()
            .then(() => this.ensureServersAvailableOnStart())
            .catch((err) => logger("garupaService", `startup status check error: ${String(err)}`));
    }

    getServerCount(): number {
        return getGarupaServerCount();
    }

    getServerIds(): number[] {
        return getGarupaServerIds();
    }

    getActiveServerIds(): number[] {
        return this.getConfiguredServerIds().filter((server) => !this.disabledServers.has(server));
    }

    /** 仅按配置过滤（排除 GARUPA_SERVER_BASES 中值为 "-" 的），不关心服务器是否被临时禁用 */
    getConfiguredServerIds(): number[] {
        return this.getServerIds();
    }

    getClientVersion(server: number): string {
        const version = this.serverClientVersions.get(server);
        if (!version) {
            throw new Error(`client version unavailable for server=${server}`);
        }
        return version;
    }

    registerPoller(key: string, callback: () => Promise<void>, intervalMs?: number): void {
        this.pollers.set(key, {
            fn: callback,
            intervalMs: intervalMs ?? GARUPA_REFRESH_INTERVAL_SECONDS * 1000,
            lastRun: 0,
        });
        this.start();
        this.scheduleNextTick();
    }

    async runWithAvailability<T>(server: number, action: () => Promise<T>, options?: { timeoutMs?: number }): Promise<T | undefined> {
        this.start();
        await this.initializeClientVersions();
        const timeoutMs = options?.timeoutMs ?? 2000;
        let status = await this.assessServerStatus(server, timeoutMs);
        if (status.disabled) {
            logger("garupaService", `skipping request for server=${server} due to repeated unavailability (${status.unavailabilityCount})`);
            return undefined;
        }

        try {
            return await action();
        } catch (error) {
            const errorMsg = String(error);

            if (errorMsg.includes("426") || errorMsg.toLowerCase().includes("update_required")) {
                logger(
                    "garupaService",
                    `[HTTP 426 Bypass] Server claims available, but business API rejected. Force refreshing version for server=${server}...`,
                );
                await this.refreshClientVersion(server, "business_426_fallback");
            }
            status = await this.assessServerStatus(server, timeoutMs);
            if (!status.available || status.thresholdReached || this.disabledServers.has(server)) {
                await this.waitUntilAvailableWithLogging(server, timeoutMs);
                return await action();
            }
            throw error;
        }
    }

    private async assessServerStatus(server: number, timeoutMs: number = 2000): Promise<GarupaServerStatus> {
        try {
            const ok = await checkGarupaGameStatus(server, this.getClientVersion(server), timeoutMs);
            if (ok) {
                this.markServerAvailable(server);
                return {
                    available: true,
                    disabled: false,
                    unavailabilityCount: 0,
                    thresholdReached: false,
                };
            }
        } catch {
            // ignore and treat as unavailable
        }

        const prev = this.getUnavailabilityCount(server);
        const next = prev + 1;
        this.unavailabilityCounts.set(server, next);
        const threshold = getGarupaStatusUnavailabilityThreshold();
        const thresholdReached = next === threshold;
        if (next >= threshold) {
            this.disabledServers.add(server);
            if (thresholdReached) {
                void this.waitUntilAvailableWithLogging(server, timeoutMs);
            }
        }

        return {
            available: false,
            disabled: this.disabledServers.has(server),
            unavailabilityCount: next,
            thresholdReached,
        };
    }

    private async ensureServersAvailableOnStart(): Promise<void> {
        const servers = this.getServerIds();
        for (const server of servers) {
            try {
                const status = await this.assessServerStatus(server, 2000);
                if (!status.available) {
                    await this.waitUntilAvailableWithLogging(server, 2000);
                }
            } catch (err) {
                logger("garupaService", `startup status check error server=${server}: ${String(err)}`);
            }
        }
    }

    private scheduleNextTick(): void {
        if (this.refreshTimeout || this.refreshInterval) {
            return;
        }

        const now = new Date();
        const next = new Date(now);
        next.setSeconds(GARUPA_REFRESH_AT_SECOND, 0);

        if (next <= now) {
            next.setMinutes(next.getMinutes() + 1);
        }

        const delayMs = Math.max(0, next.getTime() - now.getTime());
        this.refreshTimeout = setTimeout(() => {
            void this.runPollers();
            this.startInterval();
        }, delayMs);
        this.refreshTimeout.unref();
    }

    private startInterval(): void {
        if (this.refreshInterval) {
            return;
        }

        const intervalMs = Math.max(1, GARUPA_REFRESH_INTERVAL_SECONDS) * 1000;
        this.refreshInterval = setInterval(() => {
            void this.runPollers();
        }, intervalMs);
        this.refreshInterval.unref();
    }

    private async runPollers(): Promise<void> {
        if (this.pollers.size === 0) {
            return;
        }

        const now = Date.now();
        const tasks: Promise<void>[] = [];
        for (const [, entry] of this.pollers) {
            if (now - entry.lastRun < entry.intervalMs) {
                continue;
            }
            entry.lastRun = now;
            tasks.push(entry.fn());
        }
        await Promise.allSettled(tasks);
    }

    private async waitUntilAvailableWithLogging(server: number, timeoutMs: number): Promise<void> {
        const existing = this.recoveryInFlight.get(server);
        if (existing) {
            await existing;
            return;
        }

        const task = (async () => {
            logger("garupaService", `waiting for server=${server} to become available`);
            await this.initializeClientVersions();
            await this.refreshClientVersion(server, "recovery");
            await waitUntilGarupaAvailable(server, this.getClientVersion(server), getGarupaStatusPollIntervalMs(), timeoutMs);
            this.markServerAvailable(server);
            logger("garupaService", `server=${server} is now available`);
            logger("garupaService", `server=${server} recovered and will resume requests`);
        })();

        this.recoveryInFlight.set(server, task);
        try {
            await task;
        } finally {
            this.recoveryInFlight.delete(server);
        }
    }

    private async initializeClientVersions(): Promise<void> {
        if (this.initTask) {
            return this.initTask;
        }

        this.initTask = (async () => {
            await this.loadCachedClientVersions();
            await this.refreshAllClientVersions("startup");
        })();

        return this.initTask;
    }

    private async loadCachedClientVersions(): Promise<void> {
        try {
            await database.ready();
            const query = await garupaMetaCollection.find({});
            const records = await query.toArray();
            for (const record of records) {
                if (record?.clientVersion?.length > 0) {
                    this.serverClientVersions.set(record.server, record.clientVersion);
                }
            }
        } catch (err) {
            logger("garupaService", `failed to load cached versions: ${String(err)}`);
        }

        for (const server of this.getServerIds()) {
            if (this.serverClientVersions.has(server)) {
                continue;
            }
            const fallback = getGarupaFallbackClientVersion(server);
            if (fallback) {
                this.serverClientVersions.set(server, fallback);
                logger("garupaService", `server=${server} client version seeded from env fallback: ${fallback}`);
            }
        }
    }

    private async refreshAllClientVersions(reason: string): Promise<void> {
        const servers = getGarupaServerIds();
        await Promise.allSettled(servers.map((server) => this.refreshClientVersion(server, reason)));
    }

    private async refreshClientVersion(server: number, reason: string): Promise<void> {
        const existing = this.versionRefreshInFlight.get(server);
        if (existing) {
            await existing;
            return;
        }

        const task = (async () => {
            try {
                const baseUrl = getGarupaPackageUrl(server);
                const urlObj = new URL(baseUrl);
                urlObj.searchParams.set("t", Date.now().toString());
                const url = urlObj.toString();
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), getGarupaVersionCheckTimeoutMs());
                let res: Response;
                try {
                    res = await fetch(url, {
                        signal: controller.signal,
                        headers: {
                            "User-Agent":
                                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0",
                        },
                    });
                } finally {
                    clearTimeout(tid);
                }
                if (!res.ok) {
                    logger("garupaService", `server=${server} package lookup failed (${reason}), HTTP ${res.status}`);
                    return;
                }
                const data = await res.json();
                const version = data?.results?.[0]?.version;
                if (typeof version !== "string" || version.length === 0) {
                    logger("garupaService", `server=${server} package lookup missing version (${reason})`);
                    return;
                }

                const prev = this.serverClientVersions.get(server);
                if (prev === version) {
                    logger("garupaService", `server=${server} client version is latest (${version})`);
                } else if (!prev || compareVersions(version, prev) > 0) {
                    this.serverClientVersions.set(server, version);
                    logger("garupaService", `server=${server} client version updated ${prev ?? "-"} -> ${version} (${reason})`);
                } else {
                    logger("garupaService", `server=${server} ignored older version from Apple: ${version} (current: ${prev ?? "-"})`);
                }

                await garupaMetaCollection.updateOne({ server }, { $set: { server, clientVersion: version, updatedAt: Date.now() } }, { upsert: true });
            } catch (err: unknown) {
                const e = err as { message?: string };
                logger("garupaService", `checkGameVersion failed server=${server} (${reason}): ${e.message ?? String(err)}`);
            }
        })();

        this.versionRefreshInFlight.set(server, task);
        try {
            await task;
        } finally {
            this.versionRefreshInFlight.delete(server);
        }
    }

    private getUnavailabilityCount(server: number): number {
        return this.unavailabilityCounts.get(server) ?? 0;
    }

    private markServerAvailable(server: number): void {
        this.unavailabilityCounts.set(server, 0);
        if (this.disabledServers.delete(server)) {
            logger("garupaService", `server=${server} became available and was re-enabled`);
        }
    }
}

export const garupaService = new GarupaService();
