import { fetchMonthlyRankingMasterListBuffer } from "@/api/garupa";
import { MONGODB_MONTHLY_INFO_COLLECTION, MONTHLY_RANKING_INFO_POLL_INTERVAL_MS } from "@/config";
import { garupaMonthlyRankingInfoParser } from "@/parsers/GarupaMonthlyRankingInfoParser";
import { garupaService } from "@/services/garupaService";
import { InfoServiceBase } from "@/services/infoServiceBase";
import { mergeNullableArray } from "@/services/rankingPersistenceHelpers";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { DatabaseFilter } from "@/storage/database";
import type {
    MonthlyRankingDetail,
    MonthlyRankingDetailList,
    MonthlyRankingInfo,
    MonthlyRankingInfoDocument,
    MonthlyRankingInfoList,
} from "@/types/monthlyRanking";

const infoCollection = database.collection<MonthlyRankingInfoDocument>(MONGODB_MONTHLY_INFO_COLLECTION);

// ============================================================================
// Merge helpers (monthly-ranking-specific)
// ============================================================================

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

// ============================================================================
// Service
// ============================================================================

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
class MonthlyRankingInfoService extends InfoServiceBase<MonthlyRankingInfoDocument, MonthlyRankingDetail> {
    // ---- Abstract contract ----

    protected get pollerName(): string {
        return "monthlyRankingInfo";
    }

    protected get pollIntervalMs(): number {
        return MONTHLY_RANKING_INFO_POLL_INTERVAL_MS;
    }

    protected get infoCollection() {
        return infoCollection;
    }

    protected getIdFilter(id: number): DatabaseFilter {
        return { monthlyRankingId: id };
    }

    protected getRecordId(record: MonthlyRankingInfoDocument): number {
        return record.monthlyRankingId;
    }

    protected mergeDetail(existing: MonthlyRankingInfoDocument | undefined, update: MonthlyRankingDetail, serverCount: number): MonthlyRankingDetail {
        return mergeMonthlyRankingDetail(existing, update, serverCount);
    }

    protected toDocument(detail: MonthlyRankingDetail, id: number, now: number): MonthlyRankingInfoDocument {
        return { ...detail, monthlyRankingId: id, updatedAt: now };
    }

    protected async fetchAndParse(server: number, serverCount: number): Promise<MonthlyRankingDetailList> {
        const clientVersion = garupaService.getClientVersion(server);
        const { decrypted, status } = await fetchMonthlyRankingMasterListBuffer(server, clientVersion);
        if (status < 200 || status >= 300) {
            throw new Error(`Monthly ranking master list HTTP ${status}`);
        }
        return garupaMonthlyRankingInfoParser.parse(decrypted, server, serverCount);
    }

    // ---- Public methods (monthly-ranking-specific) ----

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
        return this.getDetail(monthlyRankingId);
    }

    /**
     * Returns the full detail list for all monthly rankings in the cache.
     *
     * @returns An object mapping ranking ID strings to {@link MonthlyRankingDetail} objects.
     */
    async getMonthlyRankingDetailList(): Promise<MonthlyRankingDetailList> {
        await this.ensureCacheLoaded();
        return this.getAllDetails() as MonthlyRankingDetailList;
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
        return this.findActiveId(server, now);
    }
}

export const monthlyRankingInfoService = new MonthlyRankingInfoService();
