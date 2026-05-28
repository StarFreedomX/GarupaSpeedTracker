import { fetchMonthlyRanking, fetchMonthlyRankingBuffer } from "@/api/garupa";
import { MONGODB_MONTHLY_BORDER_POINTS_COLLECTION, MONGODB_MONTHLY_TOP_POINTS_COLLECTION } from "@/config";
import { logger } from "@/logger";
import { garupaService } from "@/services/garupaService";
import { monthlyRankingInfoService } from "@/services/monthlyRankingInfoService";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type {
    MonthlyRankingBandoriRaw,
    MonthlyRankingBorderDocument,
    MonthlyRankingBorderPoint,
    MonthlyRankingBorderResponse,
    MonthlyRankingBorderTier,
    MonthlyRankingPlayer,
    MonthlyRankingTopDocument,
    MonthlyRankingTopResponse,
} from "@/types/monthlyRanking";

const topCollection = database.collection<MonthlyRankingTopDocument>(MONGODB_MONTHLY_TOP_POINTS_COLLECTION);
const borderCollection = database.collection<MonthlyRankingBorderDocument>(MONGODB_MONTHLY_BORDER_POINTS_COLLECTION);

const MONTHLY_RANKING_BORDER_TIERS: MonthlyRankingBorderTier[] = [20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 3000, 4000, 5000];
const BORDER_TIER_SET = new Set<number>(MONTHLY_RANKING_BORDER_TIERS);

export const isMonthlyRankingBorderTier = (value: number): value is MonthlyRankingBorderTier => BORDER_TIER_SET.has(value);

const getClientVersion = (server: number): string => garupaService.getClientVersion(server);

const buildBorderBuckets = (raw: MonthlyRankingBandoriRaw, timestamp: number): Map<MonthlyRankingBorderTier, MonthlyRankingBorderPoint> => {
    const byTier = new Map<MonthlyRankingBorderTier, MonthlyRankingBorderPoint>();
    for (const row of raw.monthlyRankingPointBorderUsers) {
        if (!isMonthlyRankingBorderTier(row.tier)) {
            continue;
        }

        byTier.set(row.tier, {
            time: timestamp,
            ep: row.point,
        });
    }

    return byTier;
};

export const getCurrentMonthlyId = async (server: number, date: Date = new Date()): Promise<number | null> => {
    const now = date.getTime();
    return monthlyRankingInfoService.getActiveMonthlyId(server, now);
};

export const getMonthlyRankingServerCount = (): number => garupaService.getServerCount();

class MonthlyRankingService {
    private refreshInFlight = false;

    constructor() {
        garupaService.start();
    }

    start(): void {
        garupaService.start();

        garupaService.registerPoller("monthlyRanking", async () => this.refreshAll());
    }

    async refreshAll(): Promise<void> {
        if (this.refreshInFlight) {
            return;
        }

        this.refreshInFlight = true;
        const servers = garupaService.getActiveServerIds();

        try {
            await Promise.allSettled(
                servers.map(async (server) => {
                    const monthlyId = await monthlyRankingInfoService.getActiveMonthlyId(server);
                    if (!monthlyId) {
                        return;
                    }
                    await this.refreshServer(server, monthlyId);
                }),
            );
        } finally {
            this.refreshInFlight = false;
        }
    }

    async refreshServer(server: number, monthlyId: number): Promise<void> {
        await garupaService.runWithAvailability(
            server,
            async () => {
                try {
                    const raw = await fetchMonthlyRanking(server, monthlyId, getClientVersion(server));
                    const timestamp = Date.now();
                    await this.persistTopSnapshot(server, monthlyId, timestamp, raw);
                    await this.persistBorderByTier(server, monthlyId, timestamp, raw);
                    logger("monthlyRanking", `stored monthly=${monthlyId} server=${server}`);
                    return;
                } catch (error: unknown) {
                    const nodeError = error as { message?: string };
                    logger("monthlyRanking", `refresh failed server=${server} monthly=${monthlyId}: ${nodeError.message ?? "unknown error"}`);
                }

                try {
                    const diag = await fetchMonthlyRankingBuffer(server, monthlyId, getClientVersion(server));
                    const prefix = diag.decrypted.subarray(0, 64).toString("hex");
                    logger(
                        "monthlyRanking",
                        `diagnostic fetch server=${server} monthly=${monthlyId} status=${diag.status} body_bytes=${diag.length} decrypted_prefix=${prefix}`,
                    );
                } catch (diagError: unknown) {
                    const nodeError = diagError as { message?: string };
                    logger("monthlyRanking", `diagnostic fetch failed: ${nodeError.message ?? "unknown error"}`);
                }

                try {
                    const raw = await fetchMonthlyRanking(server, monthlyId, getClientVersion(server));
                    const timestamp = Date.now();
                    await this.persistTopSnapshot(server, monthlyId, timestamp, raw);
                    await this.persistBorderByTier(server, monthlyId, timestamp, raw);
                    logger("monthlyRanking", `stored monthly=${monthlyId} server=${server} (retry)`);
                    return;
                } catch (error: unknown) {
                    const nodeError = error as { message?: string };
                    logger("monthlyRanking", `refresh failed server=${server} monthly=${monthlyId} after retry: ${nodeError.message ?? "unknown error"}`);
                    throw error;
                }
            },
            { timeoutMs: 2000 },
        );
    }

    async getTopSnapshot(server: number, monthlyId: number): Promise<MonthlyRankingTopResponse> {
        const query = await topCollection.find({ server, monthlyId });
        const records = await query.sort({ bucket: 1 }).toArray();
        if (records.length === 0) {
            return { points: [], users: [] };
        }

        const points = records.flatMap((record) => record.points ?? []);

        let latestUsers: MonthlyRankingPlayer[] = [];
        let latestUpdatedAt = -1;
        for (const record of records) {
            if (record.updatedAt > latestUpdatedAt) {
                latestUpdatedAt = record.updatedAt;
                latestUsers = record.users ?? [];
            }
        }

        return {
            points,
            users: latestUsers,
        };
    }

    //  持久化
    private async persistTopSnapshot(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const newPoints = raw.monthlyRankingPointTopUsers.map((u) => ({ timestamp, uid: u.uid, value: u.point }));
        const users: MonthlyRankingPlayer[] = raw.monthlyRankingPointTopUsers.map(({ point: _p, tier: _t, ...user }) => user);
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

        await topCollection.updateOne(
            { server, monthlyId, bucket },
            [
                {
                    $set: {
                        points: { $concatArrays: [{ $ifNull: ["$points", []] }, newPoints] },
                        updatedAt: timestamp,
                        users,
                        server: { $ifNull: ["$server", server] },
                        monthlyId: { $ifNull: ["$monthlyId", monthlyId] },
                        bucket: { $ifNull: ["$bucket", bucket] },
                    },
                },
            ],
            { upsert: true },
        );

        logger("monthlyRanking", `top snapshot persisted server=${server} monthly=${monthlyId} bucket=${bucket} points_added=${newPoints.length}`);
    }

    async getBorderPoints(server: number, monthlyId: number, tier: MonthlyRankingBorderTier): Promise<MonthlyRankingBorderResponse> {
        const record = await borderCollection.findOne({ server, monthlyId, tier });
        if (!record) {
            return { result: true, cutoffs: [] };
        }

        return {
            result: record.result,
            cutoffs: record.cutoffs,
        };
    }

    private async persistBorderByTier(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const byTier = buildBorderBuckets(raw, timestamp);
        logger("monthlyRanking", `border tiers parsed server=${server} monthly=${monthlyId}: [${Array.from(byTier.keys()).join(",")}]`);
        const writes: Promise<void>[] = [];

        for (const [tier, cutoff] of byTier) {
            const write = borderCollection.updateOne(
                { server, monthlyId, tier },
                [
                    {
                        $set: {
                            cutoffs: { $concatArrays: [{ $ifNull: ["$cutoffs", []] }, [cutoff]] },
                            updatedAt: timestamp,
                            result: true,
                            server: { $ifNull: ["$server", server] },
                            monthlyId: { $ifNull: ["$monthlyId", monthlyId] },
                            tier: { $ifNull: ["$tier", tier] },
                        },
                    },
                ],
                { upsert: true },
            );
            writes.push(write);
        }

        await Promise.all(writes);
    }

    // scheduling handled by garupaService poller
}

export const monthlyRankingService = new MonthlyRankingService();
