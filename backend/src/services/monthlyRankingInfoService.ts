import { fetchMonthlyRankingMasterListBuffer } from "@/api/garupa";
import { MONGODB_MONTHLY_INFO_COLLECTION, MONTHLY_RANKING_INFO_POLL_INTERVAL_MS } from "@/config";
import { logger } from "@/logger";
import { garupaMonthlyRankingInfoParser } from "@/parsers/GarupaMonthlyRankingInfoParser";
import { garupaService } from "@/services/garupaService";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type {
    MonthlyRankingDetail,
    MonthlyRankingDetailList,
    MonthlyRankingInfo,
    MonthlyRankingInfoDocument,
    MonthlyRankingInfoList,
} from "@/types/monthlyRanking";

const infoCollection = database.collection<MonthlyRankingInfoDocument>(MONGODB_MONTHLY_INFO_COLLECTION);

/**
 * Creates an array of the given length, filled with the provided fallback value,
 * then copies any non-null entries from the input array into the result.
 *
 * @param input - Source array, may be undefined.
 * @param length - Desired length of the returned array.
 * @param fillValue - Value used for uninitialized or missing slots.
 * @returns A fixed-length array with existing values copied in place.
 */
const toNullableArray = <T>(input: Array<T | null> | undefined, length: number, fillValue: T | null): Array<T | null> => {
    const out = Array.from({ length }, () => fillValue);
    if (!input) {
        return out;
    }
    for (let i = 0; i < Math.min(input.length, length); i++) {
        out[i] = input[i] ?? fillValue;
    }
    return out;
};

/**
 * Merges an existing nullable array with an update, preserving existing non-null
 * values and overwriting only where the update provides a non-null entry.
 *
 * @param existing - The current array (may be undefined).
 * @param update - The update array to merge on top.
 * @param length - Fixed length of the resulting array.
 * @returns A merged array of the given length.
 */
const mergeNullableArray = <T>(existing: Array<T | null> | undefined, update: Array<T | null>, length: number): Array<T | null> => {
    const merged = toNullableArray(existing, length, null);
    for (let i = 0; i < Math.min(update.length, length); i++) {
        if (update[i] !== null) {
            merged[i] = update[i];
        }
    }
    return merged;
};

/**
 * Merges an existing (cached) monthly ranking detail document with an incoming update.
 *
 * For per-server array fields, existing non-null values take priority for servers
 * already populated; null slots in the update are skipped. Non-array fields
 * (asset bundle name, BGM file name) are preserved from the existing document
 * when already present.
 *
 * @param existing - The previously persisted document, or undefined for new rankings.
 * @param update - The parsed detail from the latest master list fetch.
 * @param serverCount - Total number of servers (determines array lengths).
 * @returns A fully merged {@link MonthlyRankingDetail}.
 */
const mergeMonthlyRankingDetail = (
    existing: MonthlyRankingInfoDocument | undefined,
    update: MonthlyRankingDetail,
    serverCount: number,
): MonthlyRankingDetail => {
    const monthlyRankingName = mergeNullableArray(existing?.monthlyRankingName, update.monthlyRankingName, serverCount);
    const startAt = mergeNullableArray(existing?.startAt, update.startAt, serverCount);
    const endAt = mergeNullableArray(existing?.endAt, update.endAt, serverCount);
    const enableFlag = mergeNullableArray(existing?.enableFlag, update.enableFlag, serverCount);
    const publicStartAt = mergeNullableArray(existing?.publicStartAt, update.publicStartAt, serverCount);
    const publicEndAt = mergeNullableArray(existing?.publicEndAt, update.publicEndAt, serverCount);
    const distributionStartAt = mergeNullableArray(existing?.distributionStartAt, update.distributionStartAt, serverCount);
    const distributionEndAt = mergeNullableArray(existing?.distributionEndAt, update.distributionEndAt, serverCount);
    const aggregateEndAt = mergeNullableArray(existing?.aggregateEndAt, update.aggregateEndAt, serverCount);
    const receptionEndAt = mergeNullableArray(existing?.receptionEndAt, update.receptionEndAt, serverCount);
    const rewards = mergeNullableArray(existing?.rewards, update.rewards ?? [], serverCount);
    const grades = mergeNullableArray(existing?.grades, update.grades ?? [], serverCount);

    const assetBundleName = existing?.assetBundleName?.length ? existing.assetBundleName : update.assetBundleName;
    const bgmFileName = existing?.bgmFileName?.length ? existing.bgmFileName : update.bgmFileName;

    return {
        monthlyRankingId: update.monthlyRankingId,
        monthlyRankingName,
        assetBundleName,
        bgmFileName,
        startAt,
        endAt,
        enableFlag,
        publicStartAt,
        publicEndAt,
        distributionStartAt,
        distributionEndAt,
        aggregateEndAt,
        receptionEndAt,
        rewards,
        grades,
    };
};

/**
 * Projects a full {@link MonthlyRankingInfoDocument} down to the public-facing
 * {@link MonthlyRankingInfo} view by selecting only the fields exposed to consumers.
 *
 * @param document - The stored monthly ranking info document.
 * @returns A lightweight monthly ranking info object.
 */
const toMonthlyRankingInfo = ({ monthlyRankingName, assetBundleName, bgmFileName, startAt, endAt }: MonthlyRankingInfoDocument): MonthlyRankingInfo => ({
    monthlyRankingName,
    assetBundleName,
    bgmFileName,
    startAt,
    endAt,
});

/**
 * Manages monthly ranking master list data with an in-memory cache and
 * periodic polling (adaptive interval).
 *
 * The service loads persisted data from MongoDB on first access, then
 * periodically fetches updated master lists from the Garupa API per server.
 * Polling is skipped for servers that currently have an active monthly
 * ranking period, since ranking info is static during an active month.
 *
 * Merge helpers ensure that per-server nullable-array fields preserve
 * already-known values across servers.
 */
class MonthlyRankingInfoService {
    /** Whether a full refresh loop is currently in progress. */
    private refreshInFlight = false;
    /** Whether the in-memory cache has been populated from MongoDB. */
    private cacheLoaded = false;
    /** In-memory cache keyed by monthly ranking ID. */
    private infoCache = new Map<number, MonthlyRankingInfoDocument>();
    /** Next allowed poll timestamp per server (adaptive interval). */
    private nextPollAtByServer = new Map<number, number>();

    constructor() {
        garupaService.start();
    }

    /**
     * Starts the service and registers a periodic poller with the garupa service.
     */
    start(): void {
        garupaService.start();
        garupaService.registerPoller("monthlyRankingInfo", async () => this.refreshAll());
    }

    /**
     * Returns the public-facing info list for all monthly rankings in the cache.
     *
     * @returns An object mapping ranking ID strings to {@link MonthlyRankingInfo} objects.
     */
    async getMonthlyRankingInfoList(): Promise<MonthlyRankingInfoList> {
        await this.ensureCacheLoaded();
        const out: MonthlyRankingInfoList = {};
        for (const [monthlyRankingId, info] of this.infoCache) {
            out[String(monthlyRankingId)] = toMonthlyRankingInfo(info);
        }
        return out;
    }

    /**
     * Returns the full detail for a single monthly ranking, or undefined if not found.
     *
     * The returned object excludes MongoDB-internal fields (`_id`, `updatedAt`).
     *
     * @param monthlyRankingId - The numeric ranking ID.
     * @returns The ranking detail, or undefined.
     */
    async getMonthlyRankingDetail(monthlyRankingId: number): Promise<MonthlyRankingDetail | undefined> {
        await this.ensureCacheLoaded();
        const record = this.infoCache.get(monthlyRankingId);
        if (!record) {
            return undefined;
        }

        const { updatedAt: _updatedAt, ...detail } = record;
        delete (detail as Record<string, unknown>)._id;
        return detail;
    }

    /**
     * Returns the full detail list for all monthly rankings in the cache.
     *
     * @returns An object mapping ranking ID strings to {@link MonthlyRankingDetail} objects.
     */
    async getMonthlyRankingDetailList(): Promise<MonthlyRankingDetailList> {
        await this.ensureCacheLoaded();
        const out: MonthlyRankingDetailList = {};
        for (const [monthlyRankingId, record] of this.infoCache) {
            const { updatedAt: _updatedAt, ...detail } = record;
            delete (detail as Record<string, unknown>)._id;
            out[String(monthlyRankingId)] = detail;
        }
        return out;
    }

    /**
     * Finds the ID of the currently active monthly ranking period for a given server.
     *
     * A ranking is considered active if `now` falls within its `[startAt, endAt]`
     * range for that server. If multiple periods overlap, the one with the latest
     * start time wins.
     *
     * @param server - The server index (0-based).
     * @param now - The reference timestamp (defaults to `Date.now()`).
     * @returns The active ranking ID, or null if no period is currently active.
     */
    async getActiveMonthlyId(server: number, now: number = Date.now()): Promise<number | null> {
        await this.ensureCacheLoaded();
        return this.findActiveMonthlyId(server, now);
    }

    /**
     * Scans the in-memory cache for the active monthly ranking on a given server.
     *
     * @param server - The server index.
     * @param now - The reference timestamp.
     * @returns The matching ranking ID or null.
     */
    private findActiveMonthlyId(server: number, now: number): number | null {
        let bestId: number | null = null;
        let bestStartAt = -1;
        for (const [monthlyRankingId, info] of this.infoCache) {
            const startAt = info.startAt?.[server];
            const endAt = info.endAt?.[server];
            if (typeof startAt !== "number" || typeof endAt !== "number") {
                continue;
            }
            if (now < startAt || now > endAt) {
                continue;
            }
            if (startAt > bestStartAt) {
                bestStartAt = startAt;
                bestId = monthlyRankingId;
            }
        }
        return bestId;
    }

    /**
     * Triggers a full refresh across all active servers.
     *
     * Only one refresh loop is allowed at a time (guarded by refreshInFlight).
     * Each server is refreshed independently; failures on one server do not
     * block others.
     */
    async refreshAll(): Promise<void> {
        if (this.refreshInFlight) {
            return;
        }
        this.refreshInFlight = true;
        try {
            await this.ensureCacheLoaded();
            const servers = garupaService.getActiveServerIds();
            await Promise.allSettled(servers.map((server) => this.refreshServerIfNeeded(server)));
        } finally {
            this.refreshInFlight = false;
        }
    }

    /**
     * Refreshes a single server's master list if the adaptive polling interval
     * has elapsed.
     *
     * After a fetch attempt (success or failure), the next poll time is set to
     * `now + MONTHLY_RANKING_INFO_POLL_INTERVAL_MS`.
     *
     * @param server - The server index.
     */
    private async refreshServerIfNeeded(server: number): Promise<void> {
        const now = Date.now();
        if (!this.shouldPollServer(server, now)) {
            return;
        }

        try {
            await this.refreshServer(server);
        } finally {
            this.nextPollAtByServer.set(server, now + Math.max(1, MONTHLY_RANKING_INFO_POLL_INTERVAL_MS));
        }
    }

    /**
     * Determines whether a server should be polled now.
     *
     * Polling is skipped when the server has an active monthly ranking period
     * (ranking info is static during an active month). Otherwise polling occurs
     * when the elapsed time since the last poll exceeds the configured interval.
     *
     * @param server - The server index.
     * @param now - The current timestamp.
     * @returns True if the server is due for a poll.
     */
    private shouldPollServer(server: number, now: number): boolean {
        const activeId = this.findActiveMonthlyId(server, now);
        if (activeId) {
            return false;
        }

        const nextPollAt = this.nextPollAtByServer.get(server) ?? 0;
        return now >= nextPollAt;
    }

    /**
     * Fetches the monthly ranking master list for a single server, parses it,
     * and merges the results into the in-memory cache and MongoDB.
     *
     * @param server - The server index.
     */
    private async refreshServer(server: number): Promise<void> {
        const serverCount = garupaService.getServerCount();
        await garupaService.runWithAvailability(
            server,
            async () => {
                const clientVersion = garupaService.getClientVersion(server);
                const { decrypted, status } = await fetchMonthlyRankingMasterListBuffer(server, clientVersion);
                if (status < 200 || status >= 300) {
                    throw new Error(`Monthly ranking master list HTTP ${status}`);
                }

                const parsed = garupaMonthlyRankingInfoParser.parse(decrypted, server, serverCount);
                await this.mergeAndPersist(parsed);
                logger("monthlyRankingInfo", `master list refreshed server=${server} entries=${Object.keys(parsed).length}`);
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Merges a parsed batch of monthly ranking detail updates into the in-memory
     * cache and persists each document to MongoDB via upsert.
     *
     * Invalid or non-positive ranking IDs are silently skipped.
     *
     * @param updates - A map of ranking ID string → parsed ranking detail.
     */
    private async mergeAndPersist(updates: MonthlyRankingDetailList): Promise<void> {
        const serverCount = garupaService.getServerCount();
        const now = Date.now();

        for (const [monthlyRankingIdRaw, update] of Object.entries(updates)) {
            const monthlyRankingId = Number(monthlyRankingIdRaw);
            if (!Number.isFinite(monthlyRankingId) || monthlyRankingId <= 0) {
                continue;
            }

            const existing = this.infoCache.get(monthlyRankingId);
            const merged = mergeMonthlyRankingDetail(existing, update, serverCount);
            const document: MonthlyRankingInfoDocument = {
                ...merged,
                monthlyRankingId,
                updatedAt: now,
            };

            this.infoCache.set(monthlyRankingId, document);
            await infoCollection.updateOne({ monthlyRankingId }, { $set: document }, { upsert: true });
        }
    }

    /**
     * Ensures the in-memory cache is loaded from MongoDB.
     *
     * Called once on first access. Subsequent calls are no-ops. Invalid records
     * (missing or non-positive ranking IDs) are skipped.
     */
    private async ensureCacheLoaded(): Promise<void> {
        if (this.cacheLoaded) {
            return;
        }

        const query = await infoCollection.find({});
        const records = await query.toArray();
        for (const record of records) {
            if (!record || !Number.isFinite(record.monthlyRankingId) || record.monthlyRankingId <= 0) {
                continue;
            }
            this.infoCache.set(record.monthlyRankingId, record);
        }
        this.cacheLoaded = true;
    }
}

export const monthlyRankingInfoService = new MonthlyRankingInfoService();
