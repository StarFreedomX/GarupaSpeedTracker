import { logger } from "@/logger";
import { garupaService } from "@/services/garupaService";
import type { DatabaseCollection, DatabaseFilter } from "@/storage/database";

// ============================================================================
// Internal constraint (not exported — only used as a type bound)
// ============================================================================

/**
 * Minimum constraint that every info document must satisfy so that the
 * abstract base class can iterate the cache and inspect {@code startAt}
 * / {@code endAt} arrays.
 */
interface HasPollingFields {
    updatedAt?: number;
    startAt?: Array<number | null>;
    endAt?: Array<number | null>;
}

// ============================================================================
// Abstract base class
// ============================================================================

/**
 * Abstract base class for services that poll a master-list endpoint, parse
 * per-server details, merge results into a persistent store, and serve
 * an in-memory cache.
 *
 * Subclasses need only supply the type-specific hooks (fetch/parse, merge,
 * document construction, collection, and id extraction) — the polling
 * loop, adaptive interval logic, cache warming, and activation detection
 * are all handled here.
 *
 * @typeParam TDocument - The MongoDB document type (must carry {@code updatedAt}, {@code startAt}, {@code endAt}).
 * @typeParam TDetail   - The parsed detail type returned by the parser.
 */
export abstract class InfoServiceBase<TDocument extends HasPollingFields, TDetail> {
    // ---- Abstract contract (subclass MUST implement) ----

    /** Human-readable name used in log messages and poller registration. */
    protected abstract get pollerName(): string;

    /** Polling interval in milliseconds (adaptive cooldown after each attempt). */
    protected abstract get pollIntervalMs(): number;

    /** MongoDB collection storing the info documents. */
    protected abstract get infoCollection(): DatabaseCollection<TDocument>;

    /**
     * Returns a MongoDB filter that identifies a single document by its
     * numeric id (e.g. `{ eventId: 123 }` or `{ monthlyRankingId: 456 }`).
     */
    protected abstract getIdFilter(id: number): DatabaseFilter;

    /**
     * Extracts the numeric primary key from a raw document (used when
     * hydrating the cache from the database).
     */
    protected abstract getRecordId(record: TDocument): number;

    /**
     * Merges an existing cached document with an incoming parsed update.
     * Existing non-null values take priority; the update fills in gaps.
     */
    protected abstract mergeDetail(existing: TDocument | undefined, update: TDetail, serverCount: number): TDetail;

    /**
     * Produces the final MongoDB document from a merged detail, the id,
     * and the current timestamp.
     */
    protected abstract toDocument(detail: TDetail, id: number, now: number): TDocument;

    /**
     * Fetches the master list for one server from the Garupa API and
     * parses it into a detail map.  The base class wraps this call with
     * {@code garupaService.runWithAvailability}.
     */
    protected abstract fetchAndParse(server: number, serverCount: number): Promise<Record<string, TDetail>>;

    // ---- Shared state ----

    /** Whether a full refresh loop is currently in progress. */
    protected refreshInFlight = false;
    /** Whether the in-memory cache has been populated from the database. */
    protected cacheLoaded = false;
    /** In-memory cache keyed by the document's numeric id. */
    protected infoCache = new Map<number, TDocument>();
    /** Next allowed poll timestamp per server (adaptive interval). */
    protected nextPollAtByServer = new Map<number, number>();

    constructor() {
        garupaService.start();
    }

    // ====================================================================
    // Public lifecycle
    // ====================================================================

    /**
     * Starts the service and registers a periodic poller with the garupa service.
     *
     * The poller ticks at the default garupa refresh interval; the adaptive
     * polling logic in {@link shouldPollServer} gates actual fetches to
     * {@link pollIntervalMs}.
     */
    start(): void {
        garupaService.start();
        garupaService.registerPoller(this.pollerName, async () => this.refreshAll());
    }

    // ====================================================================
    // Cache helpers for subclasses
    // ====================================================================

    /**
     * Returns a single detail by id, stripping internal MongoDB fields.
     */
    protected getDetail(id: number): TDetail | undefined {
        const record = this.infoCache.get(id);
        if (!record) {
            return undefined;
        }
        const { updatedAt: _updatedAt, ...detail } = record as TDocument & { updatedAt?: number };
        delete (detail as Record<string, unknown>)._id;
        return detail as unknown as TDetail;
    }

    /**
     * Returns all cached details keyed by string id, stripping internal fields.
     */
    protected getAllDetails(): Record<string, TDetail> {
        const out: Record<string, TDetail> = {};
        for (const [id, record] of this.infoCache) {
            const { updatedAt: _updatedAt, ...detail } = record as TDocument & { updatedAt?: number };
            delete (detail as Record<string, unknown>)._id;
            out[String(id)] = detail as unknown as TDetail;
        }
        return out;
    }

    // ====================================================================
    // Polling
    // ====================================================================

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
     * `now + pollIntervalMs`.
     *
     * @param server - The server index.
     */
    protected async refreshServerIfNeeded(server: number): Promise<void> {
        const now = Date.now();
        if (!this.shouldPollServer(server, now)) {
            return;
        }

        try {
            await this.refreshServer(server);
        } finally {
            this.nextPollAtByServer.set(server, now + Math.max(1, this.pollIntervalMs));
        }
    }

    /**
     * Determines whether a server should be polled now.
     *
     * Polling is skipped when the server has an active event/ranking period
     * (info is static during an active period). Otherwise polling occurs
     * when the elapsed time since the last poll exceeds the configured interval.
     *
     * @param server - The server index.
     * @param now - The current timestamp.
     * @returns True if the server is due for a poll.
     */
    protected shouldPollServer(server: number, now: number): boolean {
        const activeId = this.findActiveId(server, now);
        if (activeId) {
            return false;
        }

        const nextPollAt = this.nextPollAtByServer.get(server) ?? 0;
        return now >= nextPollAt;
    }

    /**
     * Fetches the master list for a single server, parses it, and merges
     * the results into the in-memory cache and persistent store.
     *
     * @param server - The server index.
     */
    protected async refreshServer(server: number): Promise<void> {
        const serverCount = garupaService.getServerCount();
        await garupaService.runWithAvailability(
            server,
            async () => {
                const parsed = await this.fetchAndParse(server, serverCount);
                await this.mergeAndPersist(parsed);
                logger(this.pollerName, `master list refreshed server=${server} entries=${Object.keys(parsed).length}`);
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Merges a parsed batch of detail updates into the in-memory cache
     * and persists each document to MongoDB via upsert.
     *
     * Invalid or non-positive ids are silently skipped.
     *
     * @param updates - A map of id string → parsed detail.
     */
    protected async mergeAndPersist(updates: Record<string, TDetail>): Promise<void> {
        const serverCount = garupaService.getServerCount();
        const now = Date.now();

        for (const [idRaw, update] of Object.entries(updates)) {
            const id = Number(idRaw);
            if (!Number.isFinite(id) || id <= 0) {
                continue;
            }

            const existing = this.infoCache.get(id);
            const merged = this.mergeDetail(existing, update, serverCount);
            const document = this.toDocument(merged, id, now);

            this.infoCache.set(id, document);
            await this.infoCollection.updateOne(this.getIdFilter(id), { $set: document }, { upsert: true });
        }
    }

    // ====================================================================
    // Cache hydration
    // ====================================================================

    /**
     * Ensures the in-memory cache is loaded from the database.
     *
     * Called once on first access. Subsequent calls are no-ops. Invalid
     * records (missing or non-positive ids) are skipped.
     */
    protected async ensureCacheLoaded(): Promise<void> {
        if (this.cacheLoaded) {
            return;
        }

        const query = await this.infoCollection.find({});
        const records = await query.toArray();
        for (const record of records) {
            const recordId = this.getRecordId(record);
            if (!Number.isFinite(recordId) || recordId <= 0) {
                continue;
            }
            this.infoCache.set(recordId, record);
        }
        this.cacheLoaded = true;
    }

    // ====================================================================
    // Activation detection
    // ====================================================================

    /**
     * Scans the in-memory cache for the active entry on a given server.
     *
     * An entry is considered active if `now` falls within its `[startAt, endAt]`
     * range for that server. If multiple entries overlap, the one with the
     * latest start time wins.
     *
     * @param server - The server index.
     * @param now - The reference timestamp.
     * @returns The matching id or null.
     */
    protected findActiveId(server: number, now: number): number | null {
        let bestId: number | null = null;
        let bestStartAt = -1;
        for (const [id, info] of this.infoCache) {
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
                bestId = id;
            }
        }
        return bestId;
    }
}
