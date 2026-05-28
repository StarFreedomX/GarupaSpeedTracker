import { fetchMonthlyRankingMasterListBuffer } from "@/api/garupa";
import { MONGODB_MONTHLY_INFO_COLLECTION, MONTHLY_RANKING_INFO_POLL_INTERVAL_MS } from "@/config";
import { logger } from "@/logger";
import { garupaMonthlyRankingInfoParser } from "@/parsers/GarupaMonthlyRankingInfoParser";
import { garupaService } from "@/services/garupaService";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { MonthlyRankingInfo, MonthlyRankingInfoDocument, MonthlyRankingInfoList } from "@/types/monthlyRanking";

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

const mergeMonthlyRankingInfo = (
    existing: MonthlyRankingInfo | undefined,
    update: MonthlyRankingInfo,
    server: number,
    serverCount: number,
): MonthlyRankingInfo => {
    const monthlyRankingName = toNullableArray(existing?.monthlyRankingName, serverCount, null);
    const startAt = toNullableArray(existing?.startAt, serverCount, null);
    const endAt = toNullableArray(existing?.endAt, serverCount, null);

    if (update.monthlyRankingName[server] !== null) {
        monthlyRankingName[server] = update.monthlyRankingName[server];
    }
    if (update.startAt[server] !== null) {
        startAt[server] = update.startAt[server];
    }
    if (update.endAt[server] !== null) {
        endAt[server] = update.endAt[server];
    }

    const assetBundleName = existing?.assetBundleName?.length ? existing.assetBundleName : update.assetBundleName;
    const bgmFileName = existing?.bgmFileName?.length ? existing.bgmFileName : update.bgmFileName;

    return {
        monthlyRankingName,
        assetBundleName,
        bgmFileName,
        startAt,
        endAt,
    };
};

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
            out[String(monthlyRankingId)] = {
                monthlyRankingName: info.monthlyRankingName,
                assetBundleName: info.assetBundleName,
                bgmFileName: info.bgmFileName,
                startAt: info.startAt,
                endAt: info.endAt,
            };
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
                await this.mergeAndPersist(server, parsed);
                logger("monthlyRankingInfo", `master list refreshed server=${server} entries=${Object.keys(parsed).length}`);
            },
            { timeoutMs: 2000 },
        );
    }

    private async mergeAndPersist(server: number, updates: MonthlyRankingInfoList): Promise<void> {
        const serverCount = garupaService.getServerCount();
        const now = Date.now();

        for (const [monthlyRankingIdRaw, update] of Object.entries(updates)) {
            const monthlyRankingId = Number(monthlyRankingIdRaw);
            if (!Number.isFinite(monthlyRankingId) || monthlyRankingId <= 0) {
                continue;
            }

            const existing = this.infoCache.get(monthlyRankingId);
            const merged = mergeMonthlyRankingInfo(existing, update, server, serverCount);
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
            if (!record) {
                continue;
            }
            this.infoCache.set(record.monthlyRankingId, record);
        }
        this.cacheLoaded = true;
    }
}

export const monthlyRankingInfoService = new MonthlyRankingInfoService();
