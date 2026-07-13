import { fetchEventMasterListBuffer } from "@/api/garupa";
import { EVENT_RANKING_INFO_POLL_INTERVAL_MS, MONGODB_EVENT_INFO_COLLECTION } from "@/config";
import { logger } from "@/logger";
import { garupaEventInfoParser } from "@/parsers/GarupaEventInfoParser";
import { garupaService } from "@/services/garupaService";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { EventDetail, EventDetailList, EventInfo, EventInfoDocument, EventInfoList } from "@/types/event";

const infoCollection = database.collection<EventInfoDocument>(MONGODB_EVENT_INFO_COLLECTION);

// ============================================================================
// Merge helpers (same pattern as monthlyRankingInfoService)
// ============================================================================

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
 * Merges an existing (cached) event detail document with an incoming update.
 *
 * For per-server array fields (e.g. event name, start/end times), existing non-null
 * values take priority for servers already populated; null slots in the update are
 * skipped. Non-array fields (event type, asset bundle name, BGM file name) are
 * preserved from the existing document when already present.
 *
 * @param existing - The previously persisted document, or undefined for new events.
 * @param update - The parsed event detail from the latest master list fetch.
 * @param serverCount - Total number of servers (determines array lengths).
 * @returns A fully merged {@link EventDetail}.
 */
const mergeEventDetail = (existing: EventInfoDocument | undefined, update: EventDetail, serverCount: number): EventDetail => {
    const eventName = mergeNullableArray(existing?.eventName, update.eventName, serverCount);
    const startAt = mergeNullableArray(existing?.startAt, update.startAt, serverCount);
    const endAt = mergeNullableArray(existing?.endAt, update.endAt, serverCount);
    const enableFlag = mergeNullableArray(existing?.enableFlag, update.enableFlag, serverCount);
    const publicStartAt = mergeNullableArray(existing?.publicStartAt, update.publicStartAt, serverCount);
    const publicEndAt = mergeNullableArray(existing?.publicEndAt, update.publicEndAt, serverCount);
    const distributionStartAt = mergeNullableArray(existing?.distributionStartAt, update.distributionStartAt, serverCount);
    const distributionEndAt = mergeNullableArray(existing?.distributionEndAt, update.distributionEndAt, serverCount);
    const aggregateEndAt = mergeNullableArray(existing?.aggregateEndAt, update.aggregateEndAt, serverCount);
    const receptionEndAt = mergeNullableArray(existing?.receptionEndAt, update.receptionEndAt, serverCount);
    const pointRewards = mergeNullableArray(existing?.pointRewards, update.pointRewards ?? [], serverCount);
    const rankingRewards = mergeNullableArray(existing?.rankingRewards, update.rankingRewards ?? [], serverCount);

    const eventType = existing?.eventType?.length ? existing.eventType : update.eventType;
    const assetBundleName = existing?.assetBundleName?.length ? existing.assetBundleName : update.assetBundleName;
    const bgmFileName = existing?.bgmFileName?.length ? existing.bgmFileName : update.bgmFileName;

    return {
        eventId: update.eventId,
        eventType,
        eventName,
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
        pointRewards,
        rankingRewards,
    };
};

/**
 * Projects a full {@link EventInfoDocument} down to the public-facing
 * {@link EventInfo} view by selecting only the fields exposed to consumers.
 *
 * @param document - The stored event info document.
 * @returns A lightweight event info object.
 */
const toEventInfo = ({ eventType, eventName, assetBundleName, bgmFileName, startAt, endAt }: EventInfoDocument): EventInfo => ({
    eventType,
    eventName,
    assetBundleName,
    bgmFileName,
    startAt,
    endAt,
});

// ============================================================================
// Service
// ============================================================================

/**
 * Manages event master list data with an in-memory cache and periodic polling.
 *
 * The service loads persisted data from MongoDB on first access, then periodically
 * fetches updated master lists from the Garupa API per server. The polling interval
 * is adaptive: it skips servers that currently have an active event (since event
 * info does not change during an event).
 *
 * Merge helpers ensure that per-server nullable-array fields preserve already-known
 * values across servers, filling in new servers as they become available.
 */
class EventInfoService {
    /** Whether a full refresh loop is currently in progress. */
    private refreshInFlight = false;
    /** Whether the in-memory cache has been populated from MongoDB. */
    private cacheLoaded = false;
    /** In-memory cache keyed by event ID. */
    private infoCache = new Map<number, EventInfoDocument>();
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
        garupaService.registerPoller("eventInfo", async () => this.refreshAll());
    }

    /**
     * Returns the public-facing event info list for all events in the cache.
     *
     * Each entry is projected down to {@link EventInfo} (omitting internal fields
     * like rewards, enable flags, etc.).
     *
     * @returns An object mapping event ID strings to {@link EventInfo} objects.
     */
    async getEventInfoList(): Promise<EventInfoList> {
        await this.ensureCacheLoaded();
        const out: EventInfoList = {};
        for (const [eventId, info] of this.infoCache) {
            out[String(eventId)] = toEventInfo(info);
        }
        return out;
    }

    /**
     * Returns the full detail for a single event, or undefined if not found.
     *
     * The returned object excludes MongoDB-internal fields (`_id`, `updatedAt`).
     *
     * @param eventId - The numeric event ID.
     * @returns The event detail, or undefined.
     */
    async getEventDetail(eventId: number): Promise<EventDetail | undefined> {
        await this.ensureCacheLoaded();
        const record = this.infoCache.get(eventId);
        if (!record) {
            return undefined;
        }

        const { updatedAt: _updatedAt, ...detail } = record;
        delete (detail as Record<string, unknown>)._id;
        return detail;
    }

    /**
     * Returns the full detail list for all events in the cache.
     *
     * Each entry omits MongoDB-internal fields.
     *
     * @returns An object mapping event ID strings to {@link EventDetail} objects.
     */
    async getEventDetailList(): Promise<EventDetailList> {
        await this.ensureCacheLoaded();
        const out: EventDetailList = {};
        for (const [eventId, record] of this.infoCache) {
            const { updatedAt: _updatedAt, ...detail } = record;
            delete (detail as Record<string, unknown>)._id;
            out[String(eventId)] = detail;
        }
        return out;
    }

    /**
     * Finds the ID of the currently active event for a given server.
     *
     * An event is considered active if `now` falls within its `[startAt, endAt]`
     * range for that server. If multiple events overlap, the one with the latest
     * start time wins.
     *
     * @param server - The server index (0-based).
     * @param now - The reference timestamp (defaults to `Date.now()`).
     * @returns The active event ID, or null if no event is currently active.
     */
    async getActiveEventId(server: number, now: number = Date.now()): Promise<number | null> {
        await this.ensureCacheLoaded();
        return this.findActiveEventId(server, now);
    }

    /**
     * Returns the event type string for a given event ID.
     *
     * @param eventId - The numeric event ID.
     * @returns The event type (e.g. "versus", "challenge"), or undefined if not found.
     */
    async getEventType(eventId: number): Promise<string | undefined> {
        await this.ensureCacheLoaded();
        const record = this.infoCache.get(eventId);
        return record?.eventType;
    }

    /**
     * Scans the in-memory cache for the active event on a given server.
     *
     * @param server - The server index.
     * @param now - The reference timestamp.
     * @returns The matching event ID or null.
     */
    private findActiveEventId(server: number, now: number): number | null {
        let bestId: number | null = null;
        let bestStartAt = -1;
        for (const [eventId, info] of this.infoCache) {
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
                bestId = eventId;
            }
        }
        return bestId;
    }

    // ========================================================================
    // Polling
    // ========================================================================

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
     * `now + EVENT_RANKING_INFO_POLL_INTERVAL_MS`.
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
            this.nextPollAtByServer.set(server, now + Math.max(1, EVENT_RANKING_INFO_POLL_INTERVAL_MS));
        }
    }

    /**
     * Determines whether a server should be polled now.
     *
     * Polling is skipped when the server has an active event (event info is
     * static during an event). Otherwise polling occurs when the elapsed time
     * since the last poll exceeds the configured interval.
     *
     * @param server - The server index.
     * @param now - The current timestamp.
     * @returns True if the server is due for a poll.
     */
    private shouldPollServer(server: number, now: number): boolean {
        const activeId = this.findActiveEventId(server, now);
        if (activeId) {
            // Skip frequent polling while an event is active (event info won't change)
            return false;
        }

        const nextPollAt = this.nextPollAtByServer.get(server) ?? 0;
        return now >= nextPollAt;
    }

    /**
     * Fetches the event master list for a single server, parses it, and merges
     * the results into the in-memory cache and MongoDB.
     *
     * @param server - The server index.
     */
    private async refreshServer(server: number): Promise<void> {
        const serverCount = garupaService.getServerCount();
        await garupaService.runWithAvailability(
            server,
            async () => {
                const clientVersion = garupaService.getClientVersion(server);
                const { decrypted, status } = await fetchEventMasterListBuffer(server, clientVersion);
                if (status < 200 || status >= 300) {
                    throw new Error(`Event master list HTTP ${status}`);
                }

                const parsed = garupaEventInfoParser.parse(decrypted, server, serverCount);
                await this.mergeAndPersist(parsed);
                logger("eventInfo", `master list refreshed server=${server} entries=${Object.keys(parsed).length}`);
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Merges a parsed batch of event detail updates into the in-memory cache
     * and persists each document to MongoDB via upsert.
     *
     * Invalid or non-positive event IDs are silently skipped.
     *
     * @param updates - A map of event ID string → parsed event detail.
     */
    private async mergeAndPersist(updates: EventDetailList): Promise<void> {
        const serverCount = garupaService.getServerCount();
        const now = Date.now();

        for (const [eventIdRaw, update] of Object.entries(updates)) {
            const eventId = Number(eventIdRaw);
            if (!Number.isFinite(eventId) || eventId <= 0) {
                continue;
            }

            const existing = this.infoCache.get(eventId);
            const merged = mergeEventDetail(existing, update, serverCount);
            const document: EventInfoDocument = {
                ...merged,
                eventId,
                updatedAt: now,
            };

            this.infoCache.set(eventId, document);
            await infoCollection.updateOne({ eventId }, { $set: document }, { upsert: true });
        }
    }

    /**
     * Ensures the in-memory cache is loaded from MongoDB.
     *
     * Called once on first access. Subsequent calls are no-ops. Invalid records
     * (missing or non-positive event IDs) are skipped.
     */
    private async ensureCacheLoaded(): Promise<void> {
        if (this.cacheLoaded) {
            return;
        }

        const query = await infoCollection.find({});
        const records = await query.toArray();
        for (const record of records) {
            if (!record || !Number.isFinite(record.eventId) || record.eventId <= 0) {
                continue;
            }
            this.infoCache.set(record.eventId, record);
        }
        this.cacheLoaded = true;
    }
}

export const eventInfoService = new EventInfoService();
