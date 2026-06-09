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

        // 异步触发启动检查：如果发现当前月榜没数据，立即抓取一次
        this.bootstrapCheck().catch((err) => {
            logger("monthlyRanking", `Bootstrap check failed: ${err?.message || err}`);
        });

        // 注册定时轮询
        garupaService.registerPoller("monthlyRanking", async () => this.refreshAll());
    }

    /**
     * 启动时的前置检查
     * 检查从 1 到当前 monthlyId 之间，数据库是否缺失了某些月份的数据
     * 如果缺失，则在启动时立即且仅抓取一次
     */
    private async bootstrapCheck(): Promise<void> {
        const servers = garupaService.getActiveServerIds();

        await Promise.allSettled(
            servers.map(async (server) => {
                const currentMonthlyId = await monthlyRankingInfoService.getActiveMonthlyId(server);
                if (!currentMonthlyId) {
                    return;
                }

                const missingIds: number[] = [];

                for (let id = 1; id <= currentMonthlyId; id++) {
                    const exists = await topCollection.findOne({ server, monthlyId: id }, { projection: { _id: 1 } });

                    if (!exists) {
                        missingIds.push(id);
                    }
                }

                if (missingIds.length > 0) {
                    logger(
                        "monthlyRanking",
                        `Bootstrap: Server=${server} is missing data for monthlyIds: [${missingIds.join(", ")}]. Triggering immediate fetch.`,
                    );

                    for (const missingId of missingIds) {
                        try {
                            await this.refreshServer(server, missingId);
                        } catch (err) {
                            logger("monthlyRanking", `Bootstrap error: Failed to fetch server=${server} monthly=${missingId}: ${err}`);
                        }
                    }
                } else {
                    logger("monthlyRanking", `Bootstrap: Server=${server} has all data from 1 to ${currentMonthlyId}. Skipping bootstrap fetch.`);
                }
            }),
        );
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
                const currentVersion = getClientVersion(server);

                try {
                    const raw = await fetchMonthlyRanking(server, monthlyId, currentVersion);
                    const timestamp = Date.now();
                    await this.persistTopSnapshot(server, monthlyId, timestamp, raw);
                    await this.persistBorderByTier(server, monthlyId, timestamp, raw);
                    logger("monthlyRanking", `stored monthly=${monthlyId} server=${server}`);
                    return;
                } catch (error) {
                    try {
                        const diag = await fetchMonthlyRankingBuffer(server, monthlyId, currentVersion);
                        const prefix = diag.decrypted.subarray(0, 64).toString("hex");
                        logger("monthlyRanking", `diagnostic fetch server=${server} status=${diag.status} prefix=${prefix}`);
                    } catch {
                        // 忽略诊断自身的错误
                    }

                    // 把原始错误扔出
                    throw error;
                }
            },
            { timeoutMs: 2000 },
        );
    }

    async getTopSnapshot(server: number, monthlyId: number): Promise<MonthlyRankingTopResponse> {
        const query = await topCollection.find({ server, monthlyId });
        // 按 bucket 从旧到新排序确保同一个用户如果有多次改名，后面新 bucket 里的最新名字能覆盖旧名字
        const records = await query.sort({ bucket: 1 }).toArray();
        if (records.length === 0) {
            return { points: [], users: [] };
        }

        const points = records.flatMap((record) => record.points ?? []);

        // 把所有 bucket 里的用户全部合并去重
        const userMap = new Map<number, MonthlyRankingPlayer>();

        for (const record of records) {
            if (Array.isArray(record.users)) {
                record.users.forEach((user) => {
                    // 因为 records 是按时间正序排列的
                    // 如果同一个 uid 在 bucket 0 和 bucket 1 都存在，bucket 1 的最新信息会覆盖 bucket 0
                    userMap.set(user.uid, user);
                });
            }
        }

        return {
            points,
            users: Array.from(userMap.values()), // 所有 bucket 出现过的、且保持最新状态的用户
        };
    }

    //  持久化
    private async persistTopSnapshot(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const newPoints = raw.monthlyRankingPointTopUsers.map((u) => ({ timestamp, uid: u.uid, value: u.point }));
        const currentTopUsers: MonthlyRankingPlayer[] = raw.monthlyRankingPointTopUsers.map(({ point: _p, tier: _t, ...user }) => user);
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

        // 先从数据库查出该分桶现存的记录
        const existingDoc = await topCollection.findOne({ server, monthlyId, bucket });

        // 利用 Map 进行去重和更新合并
        const userMap = new Map<number, MonthlyRankingPlayer>();

        // 如果原有记录里已经有 users 数组了，先放进 Map
        if (existingDoc && Array.isArray(existingDoc.users)) {
            existingDoc.users.forEach((user) => {
                userMap.set(user.uid, user);
            });
        }

        // 把本次抓取到的最新前十名塞进 Map。如果 uid 重复，最新的信息会直接覆盖旧信息；如果不重复，则会追加进去
        currentTopUsers.forEach((user) => {
            userMap.set(user.uid, user);
        });

        // 将合并后的 Map 还原为数组结构
        const mergedUsersArray = Array.from(userMap.values());

        // 写回数据库，继续沿用updateOne
        await topCollection.updateOne(
            { server, monthlyId, bucket },
            [
                {
                    $set: {
                        points: { $concatArrays: [{ $ifNull: ["$points", []] }, newPoints] },
                        updatedAt: timestamp,
                        users: mergedUsersArray,
                        server: { $ifNull: ["$server", server] },
                        monthlyId: { $ifNull: ["$monthlyId", monthlyId] },
                        bucket: { $ifNull: ["$bucket", bucket] },
                    },
                },
            ],
            { upsert: true },
        );

        logger(
            "monthlyRanking",
            `top snapshot persisted server=${server} monthly=${monthlyId} bucket=${bucket} points_added=${newPoints.length} total_users=${mergedUsersArray.length}`,
        );
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
