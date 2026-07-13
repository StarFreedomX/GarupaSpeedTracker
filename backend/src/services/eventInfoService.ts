import { fetchEventMasterListBuffer } from "@/api/garupa";
import { EVENT_RANKING_INFO_POLL_INTERVAL_MS, MONGODB_EVENT_INFO_COLLECTION } from "@/config";
import { garupaEventInfoParser } from "@/parsers/GarupaEventInfoParser";
import { garupaService } from "@/services/garupaService";
import { InfoServiceBase } from "@/services/infoServiceBase";
import { mergeNullableArray } from "@/services/rankingPersistenceHelpers";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { DatabaseFilter } from "@/storage/database";
import type { EventDetail, EventDetailList, EventInfo, EventInfoDocument, EventInfoList } from "@/types/event";

const infoCollection = database.collection<EventInfoDocument>(MONGODB_EVENT_INFO_COLLECTION);

// ============================================================================
// Merge helpers (event-specific)
// ============================================================================

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
class EventInfoService extends InfoServiceBase<EventInfoDocument, EventDetail> {
    // ---- Abstract contract ----

    protected get pollerName(): string {
        return "eventInfo";
    }

    protected get pollIntervalMs(): number {
        return EVENT_RANKING_INFO_POLL_INTERVAL_MS;
    }

    protected get infoCollection() {
        return infoCollection;
    }

    protected getIdFilter(id: number): DatabaseFilter {
        return { eventId: id };
    }

    protected getRecordId(record: EventInfoDocument): number {
        return record.eventId;
    }

    protected mergeDetail(existing: EventInfoDocument | undefined, update: EventDetail, serverCount: number): EventDetail {
        return mergeEventDetail(existing, update, serverCount);
    }

    protected toDocument(detail: EventDetail, id: number, now: number): EventInfoDocument {
        return { ...detail, eventId: id, updatedAt: now };
    }

    protected async fetchAndParse(server: number, serverCount: number): Promise<EventDetailList> {
        const clientVersion = garupaService.getClientVersion(server);
        const { decrypted, status } = await fetchEventMasterListBuffer(server, clientVersion);
        if (status < 200 || status >= 300) {
            throw new Error(`Event master list HTTP ${status}`);
        }
        return garupaEventInfoParser.parse(decrypted, server, serverCount);
    }

    // ---- Public methods (event-specific) ----

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
        return this.getDetail(eventId);
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
        return this.getAllDetails() as EventDetailList;
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
        return this.findActiveId(server, now);
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
}

export const eventInfoService = new EventInfoService();
