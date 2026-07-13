import { compareVersions } from "compare-versions";
import {
    checkGarupaGameStatus,
    getGarupaFallbackClientVersion,
    getGarupaPackageUrl,
    getGarupaServerCount,
    getGarupaServerIds,
    getGarupaStatusPollIntervalMs,
    getGarupaStatusUnavailabilityThreshold,
    waitUntilGarupaAvailable,
} from "@/api/garupa";
import { GARUPA_REFRESH_AT_SECOND, GARUPA_REFRESH_INTERVAL_SECONDS, MONGODB_GARUPA_META_COLLECTION } from "@/config";
import { logger } from "@/logger";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import { downloader } from "@/storage/downloader";
import type { GarupaMetaDocument } from "@/types/garupaMeta";

/**
 * Represents the current availability state of a Garupa game server.
 */
export interface GarupaServerStatus {
    /** Whether the server responded successfully to the last health check. */
    available: boolean;
    /** Whether the server has been temporarily disabled due to repeated unavailability. */
    disabled: boolean;
    /** Number of consecutive failed health checks for this server. */
    unavailabilityCount: number;
    /** Whether the unavailability threshold has been reached on this check cycle. */
    thresholdReached: boolean;
}

const garupaMetaCollection = database.collection<GarupaMetaDocument>(MONGODB_GARUPA_META_COLLECTION);

/**
 * Represents a registered periodic poller task.
 */
interface PollerEntry {
    /** The async function to execute on each poll cycle. */
    fn: () => Promise<void>;
    /** Interval in milliseconds between polling executions. */
    intervalMs: number;
    /** Timestamp (ms) of the last execution, used to determine if the interval has elapsed. */
    lastRun: number;
}

/**
 * Central service for managing Garupa game server connections.
 *
 * Responsibilities include:
 * - Tracking and refreshing client versions per server (from Apple iTunes Lookup API, cached in MongoDB).
 * - Monitoring server availability via health checks, with configurable unavailability thresholds.
 * - Temporarily disabling servers that fail repeatedly and running background recovery.
 * - Managing periodic pollers that execute on aligned intervals.
 */
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
    private pollers = new Map<string, PollerEntry>();

    /**
     * Initializes and starts the Garupa service.
     *
     * On first call, resets unavailability counters for all configured servers,
     * triggers asynchronous client version initialization from cache/remote,
     * and performs a startup availability check on all servers.
     * Subsequent calls are no-ops (idempotent via the `started` flag).
     */
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

    /**
     * Returns the total number of configured game servers.
     *
     * @returns The server count from configuration.
     */
    getServerCount(): number {
        return getGarupaServerCount();
    }

    /**
     * Returns all configured server IDs.
     *
     * @returns Array of server ID numbers.
     */
    getServerIds(): number[] {
        return getGarupaServerIds();
    }

    /**
     * Returns server IDs that are currently active (not temporarily disabled).
     *
     * Filters out servers that have exceeded the unavailability threshold
     * and are pending recovery.
     *
     * @returns Array of active server ID numbers.
     */
    getActiveServerIds(): number[] {
        return this.getConfiguredServerIds().filter((server) => !this.disabledServers.has(server));
    }

    /**
     * Returns server IDs filtered by configuration only.
     *
     * Unlike {@link getActiveServerIds}, this does not exclude servers
     * that are temporarily disabled due to unavailability.
     *
     * @returns Array of configured server ID numbers.
     */
    getConfiguredServerIds(): number[] {
        return this.getServerIds();
    }

    /**
     * Returns the cached client version for a given server.
     *
     * @param server - The server ID.
     * @returns The client version string (e.g. {@code "5.6.0"}).
     * @throws {Error} If no client version has been loaded for this server.
     */
    getClientVersion(server: number): string {
        const version = this.serverClientVersions.get(server);
        if (!version) {
            throw new Error(`client version unavailable for server=${server}`);
        }
        return version;
    }

    /**
     * Registers a named periodic poller task.
     *
     * If the service has not been started yet, this will auto-start it
     * and schedule the first tick aligned to {@code GARUPA_REFRESH_AT_SECOND}.
     *
     * @param key - Unique identifier for this poller (overwrites existing poller with the same key).
     * @param callback - Async function to execute on each poll cycle.
     * @param intervalMs - Optional poll interval in milliseconds; defaults to {@code GARUPA_REFRESH_INTERVAL_SECONDS * 1000}.
     */
    registerPoller(key: string, callback: () => Promise<void>, intervalMs?: number): void {
        this.pollers.set(key, {
            fn: callback,
            intervalMs: intervalMs ?? GARUPA_REFRESH_INTERVAL_SECONDS * 1000,
            lastRun: 0,
        });
        this.start();
        this.scheduleNextTick();
    }

    /**
     * Executes an action against a game server, gated by availability checks.
     *
     * Before running {@code action}, the server's health is assessed. If the server
     * is disabled due to repeated unavailability, the action is skipped and
     * {@code undefined} is returned.
     *
     * If the action fails with an HTTP 426 (update required) error, the client
     * version for that server is force-refreshed from Apple's API and the action
     * is retried after a fresh availability assessment.
     *
     * @param server - The server ID to target.
     * @param action - The async operation to perform against the server.
     * @param options - Optional settings.
     * @param options.timeoutMs - Timeout for the availability health check (default 2000ms).
     * @returns The result of {@code action}, or {@code undefined} if the server is disabled.
     */
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

    /**
     * Checks the health of a game server and manages its availability state.
     *
     * On success, marks the server as available (resets unavailability counter,
     * removes from disabled set). On failure, increments the unavailability counter.
     * When the counter reaches the configured threshold, the server is added to
     * the disabled set and an asynchronous background recovery is started via
     * {@link waitUntilAvailableWithLogging}.
     *
     * @param server - The server ID to check.
     * @param timeoutMs - Timeout for the health check request (default 2000ms).
     * @returns The current {@link GarupaServerStatus} for the server.
     */
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

    /**
     * Performs a startup availability check for all configured servers.
     *
     * Each server is assessed via {@link assessServerStatus}. If a server is
     * unavailable, a background recovery is started. Errors are logged but do
     * not prevent other servers from being checked.
     */
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

    /**
     * Schedules the first poller execution tick, aligned to a specific wall-clock second.
     *
     * Calculates the delay until the next occurrence of {@code GARUPA_REFRESH_AT_SECOND},
     * sets a one-shot timeout to run pollers, and then starts the regular interval.
     * If a timeout or interval is already active, this is a no-op.
     */
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

    /**
     * Starts the periodic poller execution interval.
     *
     * Uses {@code GARUPA_REFRESH_INTERVAL_SECONDS} as the interval duration.
     * If an interval is already running, this is a no-op.
     * The interval timer is unref'd so it does not keep the process alive.
     */
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

    /**
     * Executes all registered poller tasks whose interval has elapsed.
     *
     * Iterates over every registered poller, skipping those whose last run
     * is still within their configured interval. All eligible pollers are
     * executed concurrently and their results are settled via
     * {@code Promise.allSettled} (individual failures do not block others).
     */
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

    /**
     * Waits for a disabled server to become available again, with logging.
     *
     * First refreshes the client version for the server (tagged as "recovery"),
     * then polls the game server's availability endpoint until it responds
     * successfully. On success, calls {@link markServerAvailable} to re-enable
     * the server.
     *
     * Uses a deduplication map ({@code recoveryInFlight}) so that concurrent
     * callers for the same server share a single in-flight recovery promise.
     *
     * @param server - The server ID to wait for.
     * @param timeoutMs - Timeout passed to the availability polling.
     */
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

    /**
     * Initializes client version data for all servers.
     *
     * Loads cached versions from MongoDB first, then refreshes any missing
     * or outdated versions from Apple's iTunes Lookup API.
     *
     * Uses a deduplication promise ({@code initTask}) so that concurrent
     * callers share a single initialization run.
     *
     * @returns A promise that resolves when initialization is complete.
     */
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

    /**
     * Loads client versions from the MongoDB {@code GarupaMeta} collection.
     *
     * For any server that still has no version after the database query,
     * falls back to the environment variable fallback value
     * ({@code getGarupaFallbackClientVersion}).
     */
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

    /**
     * Refreshes client versions for all configured servers concurrently.
     *
     * @param reason - A label used in log messages to identify what triggered the refresh (e.g. "startup").
     */
    private async refreshAllClientVersions(reason: string): Promise<void> {
        const servers = getGarupaServerIds();
        await Promise.allSettled(servers.map((server) => this.refreshClientVersion(server, reason)));
    }

    /**
     * Fetches the latest client version for a single server from Apple's iTunes Lookup API.
     *
     * The fetched version is compared against the currently cached version:
     * - If the fetched version is newer (or no version was cached), the cache is updated.
     * - If the fetched version is the same or older, the cache is left unchanged.
     *
     * The result is persisted to the MongoDB {@code GarupaMeta} collection via upsert.
     *
     * Uses a deduplication map ({@code versionRefreshInFlight}) so that concurrent
     * callers for the same server share a single in-flight fetch.
     *
     * @param server - The server ID to refresh the version for.
     * @param reason - A label used in log messages to identify what triggered the refresh.
     */
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
                const data = await downloader.download<{ results?: Array<{ version?: string }> }>(url, {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0",
                });
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

    /**
     * Returns the current unavailability count for a server.
     *
     * @param server - The server ID.
     * @returns The number of consecutive failed health checks (0 if never incremented).
     */
    private getUnavailabilityCount(server: number): number {
        return this.unavailabilityCounts.get(server) ?? 0;
    }

    /**
     * Marks a server as available by resetting its unavailability counter.
     *
     * If the server was previously in the disabled set, it is removed
     * and a recovery log message is emitted.
     *
     * @param server - The server ID to mark as available.
     */
    private markServerAvailable(server: number): void {
        this.unavailabilityCounts.set(server, 0);
        if (this.disabledServers.delete(server)) {
            logger("garupaService", `server=${server} became available and was re-enabled`);
        }
    }
}

export const garupaService = new GarupaService();
