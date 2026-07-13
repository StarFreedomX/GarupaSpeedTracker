import { fetchEventRanking } from "@/api/garupa";
import {
    BESTDORI_API,
    EVENT_POST_END_MAX_DURATION_MS,
    EVENT_POST_END_POLL_INTERVAL_MS,
    EVENT_RANKING_REFRESH_INTERVAL_MS,
    MONGODB_EVENT_BORDER_POINTS_COLLECTION,
    MONGODB_EVENT_TOP_POINTS_COLLECTION,
    MONGODB_MUSIC_BORDER_POINTS_COLLECTION,
    MONGODB_MUSIC_TOP_POINTS_COLLECTION,
    MONGODB_RANKING_PLAYERS_COLLECTION,
} from "@/config";
import { logger } from "@/logger";
import { eventInfoService } from "@/services/eventInfoService";
import { garupaService } from "@/services/garupaService";
import { buildTopSnapshot, queryBorderPoints, replaceCutoffsInBucket, replacePointsInBucket } from "@/services/rankingPersistenceHelpers";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import { downloader } from "@/storage/downloader";
import type {
    EventRankingBandoriRaw,
    EventRankingBorderDocument,
    EventRankingBorderPoint,
    EventRankingBorderResponse,
    EventRankingBorderTier,
    EventRankingTopDocument,
    EventRankingTopResponse,
    MusicRankingBandoriRaw,
    MusicRankingBorderDocument,
    MusicRankingBorderResponse,
    MusicRankingBorderTier,
    MusicRankingTopDocument,
    MusicRankingTopResponse,
} from "@/types/event";
import type { RankingPlayerDocument, RankingUser } from "@/types/rankingUser";

// ============================================================================
// Collections
// ============================================================================

const eventTopCollection = database.collection<EventRankingTopDocument>(MONGODB_EVENT_TOP_POINTS_COLLECTION);
const eventBorderCollection = database.collection<EventRankingBorderDocument>(MONGODB_EVENT_BORDER_POINTS_COLLECTION);
const musicTopCollection = database.collection<MusicRankingTopDocument>(MONGODB_MUSIC_TOP_POINTS_COLLECTION);
const musicBorderCollection = database.collection<MusicRankingBorderDocument>(MONGODB_MUSIC_BORDER_POINTS_COLLECTION);
const playerCollection = database.collection<RankingPlayerDocument>(MONGODB_RANKING_PLAYERS_COLLECTION);

// ============================================================================
// Tier validation
// ============================================================================

const EVENT_RANKING_BORDER_TIERS: EventRankingBorderTier[] = [
    20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 3000, 4000, 5000, 10000, 20000, 30000, 40000, 50000, 100000,
];
const EVENT_BORDER_TIER_SET = new Set<number>(EVENT_RANKING_BORDER_TIERS);

const MUSIC_RANKING_BORDER_TIERS: MusicRankingBorderTier[] = [20, 30, 40, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const MUSIC_BORDER_TIER_SET = new Set<number>(MUSIC_RANKING_BORDER_TIERS);

export const isEventRankingBorderTier = (value: number): value is EventRankingBorderTier => EVENT_BORDER_TIER_SET.has(value);

export const isMusicRankingBorderTier = (value: number): value is MusicRankingBorderTier => MUSIC_BORDER_TIER_SET.has(value);

// ============================================================================
// Helpers
// ============================================================================

const getClientVersion = (server: number): string => garupaService.getClientVersion(server);

export const getEventServerCount = (): number => garupaService.getServerCount();

const buildBorderBuckets = (
    borderUsers: EventRankingBandoriRaw["eventPointBorderUsers"],
    timestamp: number,
): Map<EventRankingBorderTier, EventRankingBorderPoint> => {
    const byTier = new Map<EventRankingBorderTier, EventRankingBorderPoint>();
    if (!borderUsers) return byTier;
    for (const row of borderUsers) {
        if (!isEventRankingBorderTier(row.tier)) continue;
        byTier.set(row.tier, { time: timestamp, ep: row.point });
    }
    return byTier;
};

const buildMusicBorderBuckets = (
    borderUsers: MusicRankingBandoriRaw["scoreBorderUsers"],
    timestamp: number,
): Map<MusicRankingBorderTier, EventRankingBorderPoint> => {
    const byTier = new Map<MusicRankingBorderTier, EventRankingBorderPoint>();
    if (!borderUsers) return byTier;
    for (const row of borderUsers) {
        if (!isMusicRankingBorderTier(row.tier)) continue;
        byTier.set(row.tier, { time: timestamp, ep: row.point });
    }
    return byTier;
};

// ============================================================================
// Service
// ============================================================================

/**
 * Manages event ranking data collection, persistence, and queries.
 *
 * Polls the Garupa API at a regular interval, stores top/border snapshots
 * for event point rankings and music rankings in MongoDB, and provides
 * methods to retrieve historical ranking data. On first startup, seeds
 * active event data from the Bestdori API as a bootstrap step.
 */
class EventRankingService {
    /** Last post-end fetch timestamp per server-event key ("{server}-{eventId}"). */
    private postEndLastFetch = new Map<string, number>();

    constructor() {
        garupaService.start();
    }

    /**
     * Initializes the service by starting the Garupa service, registering
     * a poller to periodically refresh all active servers, and launching
     * a one-time bootstrap sync from Bestdori to seed historical event data.
     */
    start(): void {
        garupaService.start();
        garupaService.registerPoller("eventRanking", async () => this.refreshAll(), EVENT_RANKING_REFRESH_INTERVAL_MS);

        // Bootstrap: fire-and-forget; during the window, requests 302 to Bestdori
        this.bootstrapFromBestdori().catch((err) => {
            logger("eventRanking", `Bestdori bootstrap sync failed: ${(err as Error)?.message || err}`);
        });
    }

    /**
     * Seeds active event data from the Bestdori API on first startup.
     *
     * For each configured server, checks whether local event top data
     * already exists; if not, fetches event top points, player profiles,
     * and border cutoffs for all tiers from Bestdori and persists them
     * to MongoDB so that historical data is available immediately.
     */
    private async bootstrapFromBestdori(): Promise<void> {
        await database.ready();
        const servers = garupaService.getConfiguredServerIds();

        for (const server of servers) {
            const eventId = await eventInfoService.getActiveEventId(server);
            if (!eventId) continue;

            // Only sync if we don't already have local data
            const existing = await eventTopCollection.findOne({ server, eventId });
            if (existing) {
                logger("eventRanking", `Bootstrap: already have data for event=${eventId} server=${server}, skipping`);
                continue;
            }

            logger("eventRanking", `Bootstrap: seeding event=${eventId} server=${server} from Bestdori`);

            try {
                // Fetch event top from Bestdori
                const topUrl = `${BESTDORI_API}eventtop/data?server=${server}&event=${eventId}`;
                const topData = await downloader.download<EventRankingTopResponse>(topUrl);
                if (!topData.points || topData.points.length === 0) {
                    logger("eventRanking", `Bootstrap: Bestdori returned empty top data for event=${eventId}`);
                    continue;
                }

                // Store top data
                const timestamp = topData.points[0]?.time ?? Date.now();
                const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

                await eventTopCollection.updateOne(
                    { server, eventId, bucket },
                    {
                        $set: {
                            points: topData.points,
                            updatedAt: timestamp,
                            server,
                            eventId,
                            bucket,
                        },
                    },
                    { upsert: true },
                );

                // Store user data
                if (topData.users && topData.users.length > 0) {
                    const playerWrites = topData.users.map((user) =>
                        playerCollection.replaceOne({ server, uid: user.uid }, { ...user, server, updatedAt: timestamp }, { upsert: true }),
                    );
                    await Promise.all(playerWrites);
                }

                // Fetch event border for each tier from Bestdori
                for (const tier of EVENT_RANKING_BORDER_TIERS) {
                    try {
                        const borderUrl = `${BESTDORI_API}tracker/data?server=${server}&event=${eventId}&tier=${tier}`;
                        const borderData = await downloader.download<EventRankingBorderResponse>(borderUrl);
                        if (!borderData.cutoffs || borderData.cutoffs.length === 0) continue;

                        await eventBorderCollection.updateOne(
                            { server, eventId, tier },
                            {
                                $set: {
                                    cutoffs: borderData.cutoffs,
                                    updatedAt: timestamp,
                                    result: true,
                                    server,
                                    eventId,
                                    tier,
                                },
                            },
                            { upsert: true },
                        );
                    } catch {
                        // skip individual tier failures
                    }
                }

                logger(
                    "eventRanking",
                    `Bootstrap: seeded event=${eventId} server=${server} points=${topData.points.length} users=${topData.users?.length ?? 0} tiers=${EVENT_RANKING_BORDER_TIERS.length}`,
                );
            } catch (err) {
                logger("eventRanking", `Bootstrap: failed for event=${eventId} server=${server}: ${(err as Error)?.message || err}`);
            }
        }
    }

    /** Retry a DB write until it succeeds (waits for database recovery on transient errors). */
    private async retryPersist<T>(label: string, action: () => Promise<T>): Promise<T> {
        while (true) {
            try {
                return await action();
            } catch (err: unknown) {
                const message = (err as { message?: string })?.message ?? String(err);
                if (message.includes("Topology is closed") || message.includes("ECONNREFUSED") || message.includes("closed")) {
                    logger("eventRanking", `${label} failed (${message}), waiting for DB recovery...`);
                    await database.ready();
                    continue;
                }
                throw err;
            }
        }
    }

    // ========================================================================
    // Polling
    // ========================================================================

    /**
     * Iterates all active servers, fetches the active event ID for each,
     * and refreshes ranking data. Uses {@link Promise.allSettled} so that
     * a failure on one server does not block others.
     */
    async refreshAll(): Promise<void> {
        const servers = garupaService.getActiveServerIds();
        await Promise.allSettled(
            servers.map(async (server) => {
                const eventId = await eventInfoService.getActiveEventId(server);
                if (eventId) {
                    await this.refreshServer(server, eventId);
                } else {
                    await this.refreshPostEndIfNeeded(server);
                }
            }),
        );
    }

    /**
     * Wraps ranking fetches in {@link garupaService.runWithAvailability}
     * to respect per-server rate limits. Fetches event point ranking and,
     * depending on the event type (challenge, versus, or medley), also
     * fetches music ranking data, then persists snapshots via the
     * corresponding persistence methods.
     *
     * @param server  The game server identifier
     * @param eventId The active event ID to fetch rankings for
     */
    async refreshServer(server: number, eventId: number): Promise<void> {
        await garupaService.runWithAvailability(
            server,
            async () => {
                const clientVersion = getClientVersion(server);
                const eventType = await eventInfoService.getEventType(eventId);
                if (!eventType) {
                    logger("eventRanking", `eventId=${eventId} has no eventType, skipping`);
                    return;
                }

                // 1. Fetch event point ranking (without mid)
                const raw = await fetchEventRanking(server, eventId, eventType, clientVersion);
                let timestamp = Date.now();
                const info = await eventInfoService.getEventDetail(eventId);
                const endAt = info?.endAt?.[server];
                if (endAt && timestamp > endAt) {
                    timestamp = endAt;
                    logger("eventRanking", `event=${eventId} has ended. Clamping timestamp to endAt.`);
                }

                await this.retryPersist("persistEventTopSnapshot", () => this.persistEventTopSnapshot(server, eventId, timestamp, raw));
                await this.retryPersist("persistEventBorderByTier", () => this.persistEventBorderByTier(server, eventId, timestamp, raw));

                // 2. Handle music rankings
                if (raw.musicRankings && raw.musicRankings.length > 0) {
                    // challenge/versus: music rankings nested in response
                    for (const musicRaw of raw.musicRankings) {
                        await this.retryPersist("persistMusicTopSnapshot", () =>
                            this.persistMusicTopSnapshot(server, eventId, musicRaw.musicId, timestamp, musicRaw),
                        );
                        await this.retryPersist("persistMusicBorderByTier", () =>
                            this.persistMusicBorderByTier(server, eventId, musicRaw.musicId, timestamp, musicRaw),
                        );
                    }
                } else if (raw.medleyMusicRanking) {
                    // Medley score data included in the first response, no extra fetch needed
                    const medleyMusic = raw.medleyMusicRanking;
                    await this.retryPersist("persistMusicTopSnapshot", () => this.persistMusicTopSnapshot(server, eventId, 1, timestamp, medleyMusic));
                    await this.retryPersist("persistMusicBorderByTier", () => this.persistMusicBorderByTier(server, eventId, 1, timestamp, medleyMusic));
                }

                logger("eventRanking", `stored event=${eventId} server=${server} type=${eventType}`);
            },
            { timeoutMs: 2000 },
        );
    }

    /**
     * Checks for recently-ended events and polls them at reduced post-end frequency.
     * Skips events where the post-end duration has expired or the poll interval hasn't elapsed.
     */
    private async refreshPostEndIfNeeded(server: number): Promise<void> {
        const now = Date.now();
        const detailList = await eventInfoService.getEventDetailList();
        for (const [eventIdStr, detail] of Object.entries(detailList)) {
            const eventId = Number(eventIdStr);
            const endAt = detail.endAt?.[server];
            if (typeof endAt !== "number") continue;

            // Must be within post-end window: endAt < now <= endAt + maxDuration
            if (now <= endAt || now > endAt + EVENT_POST_END_MAX_DURATION_MS) continue;

            const key = `${server}-${eventId}`;
            // Respect poll interval
            const lastFetch = this.postEndLastFetch.get(key) ?? 0;
            if (now - lastFetch < EVENT_POST_END_POLL_INTERVAL_MS) continue;

            await this.refreshServerPostEnd(server, eventId, endAt);
        }
    }

    /**
     * Post-end polling variant of {@link refreshServer}.
     * Uses `endAt` as the snapshot timestamp and replaces existing endAt entries
     * instead of appending.
     */
    private async refreshServerPostEnd(server: number, eventId: number, endAt: number): Promise<void> {
        const key = `${server}-${eventId}`;
        this.postEndLastFetch.set(key, Date.now());

        await garupaService.runWithAvailability(
            server,
            async () => {
                const clientVersion = getClientVersion(server);
                const eventType = await eventInfoService.getEventType(eventId);
                if (!eventType) {
                    logger("eventRanking", `post-end: eventId=${eventId} has no eventType, skipping`);
                    return;
                }

                const raw = await fetchEventRanking(server, eventId, eventType, clientVersion);
                const timestamp = endAt;

                // Persist with replace mode
                await this.retryPersist("persistEventTopSnapshotReplace", () => this.persistEventTopSnapshotReplace(server, eventId, timestamp, raw));
                await this.retryPersist("persistEventBorderByTierReplace", () => this.persistEventBorderByTierReplace(server, eventId, timestamp, raw));

                // Music rankings — same replace logic
                if (raw.musicRankings && raw.musicRankings.length > 0) {
                    for (const musicRaw of raw.musicRankings) {
                        await this.retryPersist("persistMusicTopSnapshotReplace", () =>
                            this.persistMusicTopSnapshotReplace(server, eventId, musicRaw.musicId, timestamp, musicRaw),
                        );
                        await this.retryPersist("persistMusicBorderByTierReplace", () =>
                            this.persistMusicBorderByTierReplace(server, eventId, musicRaw.musicId, timestamp, musicRaw),
                        );
                    }
                } else if (raw.medleyMusicRanking) {
                    const medleyMusic = raw.medleyMusicRanking;
                    await this.retryPersist("persistMusicTopSnapshotReplace", () =>
                        this.persistMusicTopSnapshotReplace(server, eventId, 1, timestamp, medleyMusic),
                    );
                    await this.retryPersist("persistMusicBorderByTierReplace", () =>
                        this.persistMusicBorderByTierReplace(server, eventId, 1, timestamp, medleyMusic),
                    );
                }

                logger("eventRanking", `post-end stored event=${eventId} server=${server} type=${eventType}`);
            },
            { timeoutMs: 2000 },
        );
    }

    // ========================================================================
    // Persistence — Event Top
    // ========================================================================

    /**
     * Persists an event top ranking snapshot to MongoDB.
     *
     * Converts raw ranking data into timestamped point records, groups
     * them into 8-day buckets, and upserts the bucket document. Also,
     * upserts individual player profiles to the shared player collection.
     *
     * @param server    The game server identifier
     * @param eventId   The event identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param raw       The raw ranking data from the Garupa API
     */
    private async persistEventTopSnapshot(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const users = raw.eventPointTopUsers ?? [];
        const newPoints = users.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

        await eventTopCollection.updateOne(
            { server, eventId, bucket },
            [
                {
                    $set: {
                        points: { $concatArrays: [{ $ifNull: ["$points", []] }, newPoints] },
                        updatedAt: timestamp,
                        server: { $ifNull: ["$server", server] },
                        eventId: { $ifNull: ["$eventId", eventId] },
                        bucket: { $ifNull: ["$bucket", bucket] },
                    },
                },
            ],
            { upsert: true },
        );

        const currentTopUsers: RankingUser[] = users.map(({ point: _p, tier: _t, ...user }) => user);
        const playerWrites = currentTopUsers.map((user) =>
            playerCollection.replaceOne({ server, uid: user.uid }, { ...user, server, updatedAt: timestamp }, { upsert: true }),
        );
        await Promise.all(playerWrites);

        logger(
            "eventRanking",
            `event top persisted server=${server} event=${eventId} bucket=${bucket} points=${newPoints.length} players=${currentTopUsers.length}`,
        );
    }

    // ========================================================================
    // Persistence — Event Border
    // ========================================================================

    /**
     * Persists event border cutoffs by tier to MongoDB.
     *
     * Builds tier-bucketed cutoff points from the raw border user data
     * and upserts each tier's cutoffs array into the event border
     * collection.
     *
     * @param server    The game server identifier
     * @param eventId   The event identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param raw       The raw ranking data from the Garupa API
     */
    private async persistEventBorderByTier(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const byTier = buildBorderBuckets(raw.eventPointBorderUsers, timestamp);
        logger("eventRanking", `event border tiers parsed server=${server} event=${eventId}: [${Array.from(byTier.keys()).join(",")}]`);
        const writes: Promise<void>[] = [];

        for (const [tier, cutoff] of byTier) {
            const write = eventBorderCollection.updateOne(
                { server, eventId, tier },
                [
                    {
                        $set: {
                            cutoffs: { $concatArrays: [{ $ifNull: ["$cutoffs", []] }, [cutoff]] },
                            updatedAt: timestamp,
                            result: true,
                            server: { $ifNull: ["$server", server] },
                            eventId: { $ifNull: ["$eventId", eventId] },
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
    // Persistence — Music Top
    // ========================================================================

    /**
     * Persists a music ranking top snapshot to MongoDB.
     *
     * Similar to {@link persistEventTopSnapshot} but scoped to a specific
     * music track within an event. Groups points into 8-day buckets and
     * upserts player data to the shared player collection.
     *
     * @param server    The game server identifier
     * @param eventId   The event identifier
     * @param musicId   The music track identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param musicRaw  The raw music ranking data from the Garupa API
     */
    private async persistMusicTopSnapshot(
        server: number,
        eventId: number,
        musicId: number,
        timestamp: number,
        musicRaw: MusicRankingBandoriRaw,
    ): Promise<void> {
        const users = musicRaw.scoreTopUsers ?? [];
        const newPoints = users.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);

        await musicTopCollection.updateOne(
            { server, eventId, musicId, bucket },
            [
                {
                    $set: {
                        points: { $concatArrays: [{ $ifNull: ["$points", []] }, newPoints] },
                        updatedAt: timestamp,
                        server: { $ifNull: ["$server", server] },
                        eventId: { $ifNull: ["$eventId", eventId] },
                        musicId: { $ifNull: ["$musicId", musicId] },
                        bucket: { $ifNull: ["$bucket", bucket] },
                    },
                },
            ],
            { upsert: true },
        );

        const currentTopUsers: RankingUser[] = users.map(({ point: _p, tier: _t, ...user }) => user);
        const playerWrites = currentTopUsers.map((user) =>
            playerCollection.replaceOne({ server, uid: user.uid }, { ...user, server, updatedAt: timestamp }, { upsert: true }),
        );
        await Promise.all(playerWrites);
    }

    // ========================================================================
    // Persistence — Music Border
    // ========================================================================

    /**
     * Persists music ranking border cutoffs by tier to MongoDB.
     *
     * Builds tier-bucketed cutoff points from raw music border user data
     * and upserts into the music border collection.
     *
     * @param server    The game server identifier
     * @param eventId   The event identifier
     * @param musicId   The music track identifier
     * @param timestamp The snapshot timestamp (ms)
     * @param musicRaw  The raw music ranking data from the Garupa API
     */
    private async persistMusicBorderByTier(
        server: number,
        eventId: number,
        musicId: number,
        timestamp: number,
        musicRaw: MusicRankingBandoriRaw,
    ): Promise<void> {
        const byTier = buildMusicBorderBuckets(musicRaw.scoreBorderUsers, timestamp);
        const writes: Promise<void>[] = [];

        for (const [tier, cutoff] of byTier) {
            const write = musicBorderCollection.updateOne(
                { server, eventId, musicId, tier },
                [
                    {
                        $set: {
                            cutoffs: { $concatArrays: [{ $ifNull: ["$cutoffs", []] }, [cutoff]] },
                            updatedAt: timestamp,
                            result: true,
                            server: { $ifNull: ["$server", server] },
                            eventId: { $ifNull: ["$eventId", eventId] },
                            musicId: { $ifNull: ["$musicId", musicId] },
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
    // Persistence — Event Top (Replace)
    // ========================================================================

    /**
     * Replaces event top snapshot entries at the given timestamp (post-end mode).
     * Compares against existing entries with the same timestamp; skips write if unchanged.
     */
    private async persistEventTopSnapshotReplace(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const users = raw.eventPointTopUsers ?? [];
        const newPoints = users.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);
        await replacePointsInBucket(eventTopCollection, { server, eventId, bucket }, timestamp, newPoints);
    }

    // ========================================================================
    // Persistence — Event Border (Replace)
    // ========================================================================

    /**
     * Replaces event border cutoff entries at the given timestamp (post-end mode).
     */
    private async persistEventBorderByTierReplace(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const users = raw.eventPointBorderUsers ?? [];
        const byTier = buildBorderBuckets(users, timestamp);
        for (const [tier, cutoff] of byTier) {
            const filter = { server, eventId, tier };
            const newCutoffs = [cutoff];
            await replaceCutoffsInBucket(eventBorderCollection, filter, timestamp, newCutoffs);
        }
    }

    // ========================================================================
    // Persistence — Music Top (Replace)
    // ========================================================================

    /**
     * Replaces music top snapshot entries at the given timestamp (post-end mode).
     */
    private async persistMusicTopSnapshotReplace(
        server: number,
        eventId: number,
        musicId: number,
        timestamp: number,
        musicRaw: MusicRankingBandoriRaw,
    ): Promise<void> {
        const users = musicRaw.scoreTopUsers ?? [];
        const newPoints = users.map((u) => ({ time: timestamp, uid: u.uid, value: u.point }));
        const bucket = Math.floor(new Date(timestamp).getUTCDate() / 8);
        await replacePointsInBucket(musicTopCollection, { server, eventId, musicId, bucket }, timestamp, newPoints);
    }

    // ========================================================================
    // Persistence — Music Border (Replace)
    // ========================================================================

    /**
     * Replaces music border cutoff entries at the given timestamp (post-end mode).
     */
    private async persistMusicBorderByTierReplace(
        server: number,
        eventId: number,
        musicId: number,
        timestamp: number,
        musicRaw: MusicRankingBandoriRaw,
    ): Promise<void> {
        const users = musicRaw.scoreBorderUsers ?? [];
        const byTier = buildMusicBorderBuckets(users, timestamp);
        for (const [tier, cutoff] of byTier) {
            const filter = { server, eventId, musicId, tier };
            const newCutoffs = [cutoff];
            await replaceCutoffsInBucket(musicBorderCollection, filter, timestamp, newCutoffs);
        }
    }

    // ========================================================================
    // Query — Event Top
    // ========================================================================

    /**
     * Retrieves the full event top ranking history for a given server and event.
     * Delegates to {@link buildTopSnapshot}.
     *
     * @param server  The game server identifier
     * @param eventId The event identifier
     * @returns Combined points array and player metadata
     */
    async getEventTopSnapshot(server: number, eventId: number): Promise<EventRankingTopResponse> {
        return buildTopSnapshot(eventTopCollection, playerCollection, { server, eventId }, server);
    }

    // ========================================================================
    // Query — Event Border
    // ========================================================================

    /**
     * Retrieves event border cutoff history for a given server, event, and tier.
     * Delegates to {@link queryBorderPoints}.
     *
     * @param server  The game server identifier
     * @param eventId The event identifier
     * @param tier    The ranking tier (e.g., 100, 1000, 10000)
     * @returns Border cutoff data with sorted time series
     */
    async getEventBorderPoints(server: number, eventId: number, tier: EventRankingBorderTier): Promise<EventRankingBorderResponse> {
        return queryBorderPoints(eventBorderCollection, { server, eventId, tier });
    }

    // ========================================================================
    // Query — Music Top
    // ========================================================================

    /**
     * Retrieves the full music ranking top history for a given server, event,
     * and music track. Delegates to {@link buildTopSnapshot}.
     *
     * @param server  The game server identifier
     * @param eventId The event identifier
     * @param musicId The music track identifier
     * @returns Combined points array and player metadata
     */
    async getMusicTopSnapshot(server: number, eventId: number, musicId: number): Promise<MusicRankingTopResponse> {
        return buildTopSnapshot(musicTopCollection, playerCollection, { server, eventId, musicId }, server);
    }

    // ========================================================================
    // Query — Music Border
    // ========================================================================

    /**
     * Retrieves music ranking border cutoff history for a given server, event,
     * music track, and tier. Delegates to {@link queryBorderPoints}.
     *
     * @param server  The game server identifier
     * @param eventId The event identifier
     * @param musicId The music track identifier
     * @param tier    The ranking tier (e.g., 100, 1000, 10000)
     * @returns Border cutoff data with sorted time series
     */
    async getMusicBorderPoints(server: number, eventId: number, musicId: number, tier: MusicRankingBorderTier): Promise<MusicRankingBorderResponse> {
        return queryBorderPoints(musicBorderCollection, { server, eventId, musicId, tier });
    }
}

export const eventRankingService = new EventRankingService();
