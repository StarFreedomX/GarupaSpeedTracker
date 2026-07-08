import { promises as fs } from "node:fs";
import path from "node:path";
import { fetchMonthlyRanking, fetchMonthlyRankingBuffer } from "@/api/garupa";
import {
    MONGODB_GARUPA_META_COLLECTION,
    MONGODB_MONTHLY_BORDER_POINTS_COLLECTION,
    MONGODB_MONTHLY_TOP_POINTS_COLLECTION,
    MONGODB_RANKING_PLAYERS_COLLECTION,
    MONTHLY_RANKING_REFRESH_INTERVAL_MS,
} from "@/config";
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
    MonthlyRankingTopDocument,
    MonthlyRankingTopResponse,
} from "@/types/monthlyRanking";
import type { RankingPlayerDocument, RankingUser } from "@/types/rankingUser";

const topCollection = database.collection<MonthlyRankingTopDocument>(MONGODB_MONTHLY_TOP_POINTS_COLLECTION);
const borderCollection = database.collection<MonthlyRankingBorderDocument>(MONGODB_MONTHLY_BORDER_POINTS_COLLECTION);
const playerCollection = database.collection<RankingPlayerDocument>(MONGODB_RANKING_PLAYERS_COLLECTION);
const metaCollection = database.collection<{ key: string; completed: boolean; completedAt: number }>(MONGODB_GARUPA_META_COLLECTION);

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
    constructor() {
        garupaService.start();
    }

    start(): void {
        garupaService.start();

        // 先迁移旧数据，再执行启动检查和注册轮询
        this.migrateLegacyPlayers()
            .then(() => this.migrateRenamePlayersCollection())
            .then(() => {
                // 异步触发启动检查：如果发现当前月榜没数据，立即抓取一次
                this.bootstrapCheck().catch((err) => {
                    logger("monthlyRanking", `Bootstrap check failed: ${err?.message || err}`);
                });
            })
            .catch((err) => {
                logger("monthlyRanking", `Legacy player migration failed: ${err?.message || err}`);
                // 迁移失败不阻塞启动，但需要记录
            });

        // 注册定时轮询
        garupaService.registerPoller("monthlyRanking", async () => this.refreshAll(), MONTHLY_RANKING_REFRESH_INTERVAL_MS);
    }

    /**
     * 将旧 monthly_top_points 文档中内嵌的 users 数组迁移到独立的 monthly_ranking_players 集合
     * 通过 GarupaMeta 记录迁移状态，避免每次启动重复扫描
     */
    private async migrateLegacyPlayers(): Promise<void> {
        await database.ready();
        const migrationKey = "migration_monthly_ranking_players";

        const migrated = await metaCollection.findOne({ key: migrationKey });
        if (migrated?.completed) {
            return;
        }

        logger("monthlyRanking", "Starting legacy player migration...");

        const legacyDocs = (await (await topCollection.find({ users: { $exists: true } })).toArray()) as unknown as (MonthlyRankingTopDocument & {
            users: RankingUser[];
        })[];
        if (legacyDocs.length === 0) {
            logger("monthlyRanking", "No legacy users data found, marking migration as complete.");
            await metaCollection.replaceOne({ key: migrationKey }, { key: migrationKey, completed: true, completedAt: Date.now() }, { upsert: true });
            return;
        }

        // 按 server + monthlyId + bucket 升序排列，保证后来的信息覆盖先前的
        legacyDocs.sort((a, b) => a.server - b.server || a.monthlyId - b.monthlyId || (a.bucket ?? 0) - (b.bucket ?? 0));

        // 按 {server, uid} 去重，后出现的覆盖先出现的
        const userMap = new Map<string, RankingUser & { server: number }>();
        for (const doc of legacyDocs) {
            if (!Array.isArray(doc.users)) {
                continue;
            }
            for (const user of doc.users) {
                userMap.set(`${doc.server}-${user.uid}`, { ...user, server: doc.server });
            }
        }

        // 写入独立集合
        const playerWrites = Array.from(userMap.values()).map((entry) => {
            const { server, ...user } = entry;
            return playerCollection.replaceOne({ server, uid: user.uid }, { ...user, server, updatedAt: Date.now() }, { upsert: true });
        });
        await Promise.all(playerWrites);

        // 清理旧字段
        const cleanWrites = legacyDocs.map((doc) =>
            topCollection.updateOne({ server: doc.server, monthlyId: doc.monthlyId, bucket: doc.bucket }, { $unset: { users: "" } }),
        );
        await Promise.all(cleanWrites);

        await metaCollection.replaceOne({ key: migrationKey }, { key: migrationKey, completed: true, completedAt: Date.now() }, { upsert: true });

        logger("monthlyRanking", `Legacy player migration completed: ${legacyDocs.length} documents processed, ${userMap.size} players migrated.`);
    }

    /**
     * 将旧集合 monthly_ranking_players 重命名为 ranking_players，以便后续引入其他榜单
     */
    private async migrateRenamePlayersCollection(): Promise<void> {
        const migrationKey = "migration_rename_ranking_players";

        const migrated = await metaCollection.findOne({ key: migrationKey });
        if (migrated?.completed) {
            return;
        }

        const collectionNames = await database.listCollectionNames();

        if (!collectionNames.includes("monthly_ranking_players")) {
            logger("monthlyRanking", "Old collection monthly_ranking_players not found, marking rename migration as complete.");
            await metaCollection.replaceOne({ key: migrationKey }, { key: migrationKey, completed: true, completedAt: Date.now() }, { upsert: true });
            return;
        }

        if (collectionNames.includes("ranking_players")) {
            logger("monthlyRanking", "Target collection ranking_players already exists, marking rename migration as complete.");
            await metaCollection.replaceOne({ key: migrationKey }, { key: migrationKey, completed: true, completedAt: Date.now() }, { upsert: true });
            return;
        }

        try {
            await database.renameCollection("monthly_ranking_players", "ranking_players");
            logger("monthlyRanking", "Renamed collection monthly_ranking_players → ranking_players successfully.");
        } catch (err) {
            const message = (err as { message?: string } | undefined)?.message ?? String(err);
            logger("monthlyRanking", `Failed to rename collection: ${message}`);
            throw err;
        }

        await metaCollection.replaceOne({ key: migrationKey }, { key: migrationKey, completed: true, completedAt: Date.now() }, { upsert: true });
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

    /** Retry a DB write until it succeeds (waits for database recovery on transient errors). */
    private async retryPersist<T>(label: string, action: () => Promise<T>): Promise<T> {
        while (true) {
            try {
                return await action();
            } catch (err: unknown) {
                const message = (err as { message?: string })?.message ?? String(err);
                if (message.includes("Topology is closed") || message.includes("ECONNREFUSED") || message.includes("closed")) {
                    logger("monthlyRanking", `${label} failed (${message}), waiting for DB recovery...`);
                    await database.ready();
                    continue;
                }
                throw err;
            }
        }
    }

    async refreshAll(): Promise<void> {
        const servers = garupaService.getActiveServerIds();
        await Promise.allSettled(
            servers.map(async (server) => {
                const monthlyId = await monthlyRankingInfoService.getActiveMonthlyId(server);
                if (!monthlyId) return;
                await this.refreshServer(server, monthlyId);
            }),
        );
    }

    async refreshServer(server: number, monthlyId: number): Promise<void> {
        await garupaService.runWithAvailability(
            server,
            async () => {
                const currentVersion = getClientVersion(server);

                try {
                    const raw = await fetchMonthlyRanking(server, monthlyId, currentVersion);
                    let timestamp = Date.now();
                    const info = await monthlyRankingInfoService.getMonthlyRankingDetail(monthlyId);
                    const endAt = info?.endAt?.[server];
                    if (endAt && timestamp > endAt) {
                        timestamp = endAt;
                        logger("monthlyRanking", `monthly=${monthlyId} has ended. Clamping timestamp to endAt: ${new Date(timestamp).toISOString()}`);
                    }
                    await this.retryPersist("persistTopSnapshot", () => this.persistTopSnapshot(server, monthlyId, timestamp, raw));
                    await this.retryPersist("persistBorderByTier", () => this.persistBorderByTier(server, monthlyId, timestamp, raw));
                    logger("monthlyRanking", `stored monthly=${monthlyId} server=${server}`);
                    return;
                } catch (error) {
                    const diagDir = path.join("cache", "diag");
                    await fs.mkdir(diagDir, { recursive: true });
                    const ts = Date.now();
                    const binFile = path.join(diagDir, `monthly-${server}-${monthlyId}-${ts}.bin`);
                    const metaFile = path.join(diagDir, `monthly-${server}-${monthlyId}-${ts}.json`);
                    try {
                        const diag = await fetchMonthlyRankingBuffer(server, monthlyId, currentVersion);
                        await fs.writeFile(binFile, diag.decrypted);
                        await fs.writeFile(
                            metaFile,
                            JSON.stringify({
                                error: (error as Error)?.message || String(error),
                                server,
                                monthlyId,
                                status: diag.status,
                                length: diag.length,
                                timestamp: ts,
                            }),
                        );
                        logger("monthlyRanking", `diagnostic saved: ${binFile} (${diag.length}B)`);
                    } catch {
                        await fs.writeFile(
                            metaFile,
                            JSON.stringify({
                                error: (error as Error)?.message || String(error),
                                server,
                                monthlyId,
                                diagnosticFetchFailed: true,
                                timestamp: ts,
                            }),
                        );
                    }
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
        points.sort((a, b) => a.timestamp - b.timestamp);

        // 只查 points 中实际出现过的 UID 对应的玩家信息
        const uidSet = new Set(points.map((p) => p.uid));
        const uids = Array.from(uidSet);

        let users: RankingUser[] = [];
        if (uids.length > 0) {
            const playerQuery = await playerCollection.find({ server, uid: { $in: uids } });
            const docs = await playerQuery.toArray();
            users = docs.map(({ server: _s, updatedAt: _u, ...player }) => {
                delete (player as Record<string, unknown>)._id;
                return player;
            });
        }

        return { points, users };
    }

    //  持久化
    private async persistTopSnapshot(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const newPoints = raw.monthlyRankingPointTopUsers.map((u) => ({ timestamp, uid: u.uid, value: u.point }));
        const currentTopUsers: RankingUser[] = raw.monthlyRankingPointTopUsers.map(({ point: _p, tier: _t, ...user }) => user);
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

        await topCollection.updateOne(
            { server, monthlyId, bucket },
            [
                {
                    $set: {
                        points: { $concatArrays: [{ $ifNull: ["$points", []] }, newPoints] },
                        updatedAt: timestamp,
                        server: { $ifNull: ["$server", server] },
                        monthlyId: { $ifNull: ["$monthlyId", monthlyId] },
                        bucket: { $ifNull: ["$bucket", bucket] },
                    },
                },
            ],
            { upsert: true },
        );

        const playerWrites = currentTopUsers.map((user) =>
            playerCollection.replaceOne({ server, uid: user.uid }, { ...user, server, updatedAt: timestamp }, { upsert: true }),
        );
        await Promise.all(playerWrites);

        logger(
            "monthlyRanking",
            `top snapshot persisted server=${server} monthly=${monthlyId} bucket=${bucket} points_added=${newPoints.length} players_upserted=${currentTopUsers.length}`,
        );
    }

    async getBorderPoints(server: number, monthlyId: number, tier: MonthlyRankingBorderTier): Promise<MonthlyRankingBorderResponse> {
        const record = await borderCollection.findOne({ server, monthlyId, tier });
        if (!record) {
            return { result: true, cutoffs: [] };
        }

        record.cutoffs.sort((a, b) => a.time - b.time);

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
