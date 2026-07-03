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

const toMonthlyRankingInfo = ({ monthlyRankingName, assetBundleName, bgmFileName, startAt, endAt }: MonthlyRankingInfoDocument): MonthlyRankingInfo => ({
    monthlyRankingName,
    assetBundleName,
    bgmFileName,
    startAt,
    endAt,
});

class MonthlyRankingInfoService {
    private refreshInFlight = false;
    private cacheLoaded = false;
    private infoCache = new Map<number, MonthlyRankingInfoDocument>();
    private nextPollAtByServer = new Map<number, number>();

    constructor() {
        garupaService.start();
    }

    start(): void {
        garupaService.start();
        garupaService.registerPoller("monthlyRankingInfo", async () => this.refreshAll());
    }

    async getMonthlyRankingInfoList(): Promise<MonthlyRankingInfoList> {
        await this.ensureCacheLoaded();
        const out: MonthlyRankingInfoList = {};
        for (const [monthlyRankingId, info] of this.infoCache) {
            out[String(monthlyRankingId)] = toMonthlyRankingInfo(info);
        }
        return out;
    }

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

    async getActiveMonthlyId(server: number, now: number = Date.now()): Promise<number | null> {
        await this.ensureCacheLoaded();
        return this.findActiveMonthlyId(server, now);
    }

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
            this.nextPollAtByServer.set(server, now + Math.max(1, MONTHLY_RANKING_INFO_POLL_INTERVAL_MS));
        }
    }

    private shouldPollServer(server: number, now: number): boolean {
        const activeId = this.findActiveMonthlyId(server, now);
        if (activeId) {
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
