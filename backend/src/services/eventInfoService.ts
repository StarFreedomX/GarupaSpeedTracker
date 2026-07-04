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

const mergeNullableArray = <T>(existing: Array<T | null> | undefined, update: Array<T | null>, length: number): Array<T | null> => {
    const merged = toNullableArray(existing, length, null);
    for (let i = 0; i < Math.min(update.length, length); i++) {
        if (update[i] !== null) {
            merged[i] = update[i];
        }
    }
    return merged;
};

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

class EventInfoService {
    private refreshInFlight = false;
    private cacheLoaded = false;
    private infoCache = new Map<number, EventInfoDocument>();
    private nextPollAtByServer = new Map<number, number>();

    constructor() {
        garupaService.start();
    }

    start(): void {
        garupaService.start();
        garupaService.registerPoller("eventInfo", async () => this.refreshAll());
    }

    async getEventInfoList(): Promise<EventInfoList> {
        await this.ensureCacheLoaded();
        const out: EventInfoList = {};
        for (const [eventId, info] of this.infoCache) {
            out[String(eventId)] = toEventInfo(info);
        }
        return out;
    }

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

    async getActiveEventId(server: number, now: number = Date.now()): Promise<number | null> {
        await this.ensureCacheLoaded();
        return this.findActiveEventId(server, now);
    }

    async getEventType(eventId: number): Promise<string | undefined> {
        await this.ensureCacheLoaded();
        const record = this.infoCache.get(eventId);
        return record?.eventType;
    }

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

    private shouldPollServer(server: number, now: number): boolean {
        const activeId = this.findActiveEventId(server, now);
        if (activeId) {
            // 有活跃活动时不频繁拉取（活动信息不会变）
            return false;
        }

        const nextPollAt = this.nextPollAtByServer.get(server) ?? 0;
        return now >= nextPollAt;
    }

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
