import { fetchMonthlyRanking } from "@/api/garupa";
import {
    MONGODB_GARUPA_META_COLLECTION,
    MONGODB_MONTHLY_BORDER_POINTS_COLLECTION,
    MONGODB_MONTHLY_TOP_POINTS_COLLECTION,
    MONGODB_RANKING_PLAYERS_COLLECTION,
    MONTHLY_POST_END_MAX_DURATION_MS,
    MONTHLY_POST_END_POLL_INTERVAL_MS,
    MONTHLY_RANKING_REFRESH_INTERVAL_MS,
} from "@/config";
import { logger } from "@/logger";
import { garupaService } from "@/services/garupaService";
import { monthlyRankingInfoService } from "@/services/monthlyRankingInfoService";
import { buildTopSnapshot, queryBorderPoints, replaceCutoffsInBucket, replacePointsInBucket } from "@/services/rankingPersistenceHelpers";
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

/**
 * Manages monthly ranking data collection, persistence, and queries.
 *
 * Polls the Garupa API at a regular interval, stores top/border snapshots
 * for monthly point rankings in MongoDB, and provides methods to retrieve
 * historical ranking data. On startup, runs legacy data migrations and a
 * bootstrap check that backfills any missing monthly data.
 */
class MonthlyRankingService {
    private postEndLastFetch = new Map<string, number>();

    constructor() {
        garupaService.start();
    }

    /**
     * Registers a poller with the Garupa service for periodic ranking refreshes.
     * Call {@link bootstrap} first to run legacy migrations and backfill missing data.
     */
    start(): void {
        garupaService.start();
        garupaService.registerPoller("monthlyRanking", async () => this.refreshAll(), MONTHLY_RANKING_REFRESH_INTERVAL_MS);
    }

    /**
     * Runs legacy player data migrations, then backfills missing monthly
     * ranking periods from the Garupa API. Call once before {@link start}
     * to avoid race conditions with normal polling.
     */
    async bootstrap(): Promise<void> {
        await this.migrateLegacyPlayers();
        await this.migrateRenamePlayersCollection();
        await this.bootstrapCheck();
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
                        // Throttle: 3s gap between each monthlyId to avoid CN rate limiting
                        await new Promise((resolve) => setTimeout(resolve, 3_000));
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

    /**
     * Iterates all active servers, fetches the active monthly ID for each,
     * and refreshes ranking data. Uses {@link Promise.allSettled} so that
     * a failure on one server does not block others.
     */
    async refreshAll(): Promise<void> {
        const servers = garupaService.getActiveServerIds();
        await Promise.allSettled(
            servers.map(async (server) => {
                const monthlyId = await monthlyRankingInfoService.getActiveMonthlyId(server);
                if (monthlyId) {
                    await this.refreshServer(server, monthlyId);
                } else {
                    await this.refreshPostEndIfNeeded(server);
                }
            }),
        );
    }

    /**
     * Wraps ranking fetches in {@link garupaService.runWithAvailability}
     * to respect per-server rate limits. Fetches monthly point ranking,
     * clamps timestamps past the ranking end time, and persists snapshots
     * via the corresponding persistence methods.
     *
     * @param server    The game server identifier
     * @param monthlyId The monthly ranking identifier
     */
    async refreshServer(server: number, monthlyId: number): Promise<void> {
        await garupaService.runWithAvailability(
            server,
            async () => {
                const currentVersion = getClientVersion(server);

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
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Checks for recently-ended monthly rankings and polls them at reduced post-end frequency.
     * Skips rankings where the post-end duration has expired or the poll interval hasn't elapsed.
     */
    private async refreshPostEndIfNeeded(server: number): Promise<void> {
        const now = Date.now();
        const detailList = await monthlyRankingInfoService.getMonthlyRankingDetailList();
        for (const [monthlyIdStr, detail] of Object.entries(detailList)) {
            const monthlyId = Number(monthlyIdStr);
            const endAt = detail.endAt?.[server];
            if (typeof endAt !== "number") continue;

            if (now <= endAt || now > endAt + MONTHLY_POST_END_MAX_DURATION_MS) continue;

            const key = `${server}-${monthlyId}`;
            const lastFetch = this.postEndLastFetch.get(key) ?? 0;
            if (now - lastFetch < MONTHLY_POST_END_POLL_INTERVAL_MS) continue;

            await this.refreshServerPostEnd(server, monthlyId, endAt);
        }
    }

    /**
     * Post-end polling variant of {@link refreshServer} for monthly rankings.
     * Uses `endAt` as the snapshot timestamp and replaces existing endAt entries
     * instead of appending.
     */
    private async refreshServerPostEnd(server: number, monthlyId: number, endAt: number): Promise<void> {
        const key = `${server}-${monthlyId}`;
        this.postEndLastFetch.set(key, Date.now());

        await garupaService.runWithAvailability(
            server,
            async () => {
                const currentVersion = getClientVersion(server);
                const raw = await fetchMonthlyRanking(server, monthlyId, currentVersion);
                const timestamp = endAt;

                await this.retryPersist("persistTopSnapshotReplace", () => this.persistTopSnapshotReplace(server, monthlyId, timestamp, raw));
                await this.retryPersist("persistBorderByTierReplace", () => this.persistBorderByTierReplace(server, monthlyId, timestamp, raw));

                logger("monthlyRanking", `post-end stored monthly=${monthlyId} server=${server}`);
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Retrieves the full monthly ranking top history for a given server and
     * monthly ID. Delegates to {@link buildTopSnapshot}.
     *
     * @param server    The game server identifier
     * @param monthlyId The monthly ranking identifier
     * @returns Combined points array and player metadata
     */
    async getTopSnapshot(server: number, monthlyId: number): Promise<MonthlyRankingTopResponse> {
        return buildTopSnapshot(topCollection, playerCollection, { server, monthlyId }, server);
    }

    /**
     * Persists a monthly ranking top snapshot to MongoDB.
     *
     * Converts raw ranking data into timestamped point records, groups
     * them into 8-day buckets, and upserts the bucket document. Also
     * upserts individual player profiles to the shared player collection.
     *
     * @param server    The game server identifier
     * @param monthlyId The monthly ranking identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param raw       The raw ranking data from the Garupa API
     */
    private async persistTopSnapshot(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const newPoints = raw.monthlyRankingPointTopUsers.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
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

    /**
     * Retrieves monthly ranking border cutoff history for a given server,
     * monthly ID, and tier. Delegates to {@link queryBorderPoints}.
     *
     * @param server    The game server identifier
     * @param monthlyId The monthly ranking identifier
     * @param tier      The ranking tier (e.g., 100, 1000, 5000)
     * @returns Border cutoff data with sorted time series
     */
    async getBorderPoints(server: number, monthlyId: number, tier: MonthlyRankingBorderTier): Promise<MonthlyRankingBorderResponse> {
        return queryBorderPoints(borderCollection, { server, monthlyId, tier });
    }

    /**
     * Persists monthly ranking border cutoffs by tier to MongoDB.
     *
     * Builds tier-bucketed cutoff points from raw border user data
     * and upserts each tier's cutoffs array into the border collection.
     *
     * @param server    The game server identifier
     * @param monthlyId The monthly ranking identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param raw       The raw ranking data from the Garupa API
     */
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

    // ========================================================================
    // Persistence — Top Snapshot (Replace)
    // ========================================================================

    /**
     * Replaces monthly top snapshot entries at the given timestamp (post-end mode).
     */
    private async persistTopSnapshotReplace(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const users = raw.monthlyRankingPointTopUsers;
        const newPoints = users.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);
        await replacePointsInBucket(topCollection, { server, monthlyId, bucket }, timestamp, newPoints);
    }

    // ========================================================================
    // Persistence — Border (Replace)
    // ========================================================================

    /**
     * Replaces monthly border cutoff entries at the given timestamp (post-end mode).
     */
    private async persistBorderByTierReplace(server: number, monthlyId: number, timestamp: number, raw: MonthlyRankingBandoriRaw): Promise<void> {
        const byTier = buildBorderBuckets(raw, timestamp);
        for (const [tier, cutoff] of byTier) {
            await replaceCutoffsInBucket(borderCollection, { server, monthlyId, tier }, timestamp, [cutoff]);
        }
    }

    // scheduling handled by garupaService poller
}

export const monthlyRankingService = new MonthlyRankingService();
