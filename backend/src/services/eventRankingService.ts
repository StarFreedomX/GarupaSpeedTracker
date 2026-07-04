import { fetchEventRanking, fetchEventRankingBuffer } from "@/api/garupa";
import {
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
import { database } from "@/storage/dataBaseAdapter/mongodb";
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

const MEDLEY_EVENT_TYPES = new Set(["medley"]);

// ============================================================================
// Service
// ============================================================================

class EventRankingService {
    private refreshInFlight = false;

    constructor() {
        garupaService.start();
    }

    start(): void {
        garupaService.start();
        garupaService.registerPoller("eventRanking", async () => this.refreshAll(), EVENT_RANKING_REFRESH_INTERVAL_MS);
    }

    // ========================================================================
    // Polling
    // ========================================================================

    async refreshAll(): Promise<void> {
        if (this.refreshInFlight) return;
        this.refreshInFlight = true;
        const servers = garupaService.getActiveServerIds();

        try {
            await Promise.allSettled(
                servers.map(async (server) => {
                    const eventId = await eventInfoService.getActiveEventId(server);
                    if (!eventId) return;
                    await this.refreshServer(server, eventId);
                }),
            );
        } finally {
            this.refreshInFlight = false;
        }
    }

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

                try {
                    // 1. Fetch event point ranking (without mid)
                    const raw = await fetchEventRanking(server, eventId, eventType, clientVersion);
                    let timestamp = Date.now();
                    const info = await eventInfoService.getEventDetail(eventId);
                    const endAt = info?.endAt?.[server];
                    if (endAt && timestamp > endAt) {
                        timestamp = endAt;
                        logger("eventRanking", `event=${eventId} has ended. Clamping timestamp to endAt.`);
                    }

                    await this.persistEventTopSnapshot(server, eventId, timestamp, raw);
                    await this.persistEventBorderByTier(server, eventId, timestamp, raw);

                    // 2. Handle music rankings
                    if (raw.musicRankings && raw.musicRankings.length > 0) {
                        // challenge/versus: music rankings nested in response
                        for (const musicRaw of raw.musicRankings) {
                            await this.persistMusicTopSnapshot(server, eventId, musicRaw.musicId, timestamp, musicRaw);
                            await this.persistMusicBorderByTier(server, eventId, musicRaw.musicId, timestamp, musicRaw);
                        }
                    } else if (MEDLEY_EVENT_TYPES.has(eventType)) {
                        // medley: fetch music ranking with mid=1
                        try {
                            const musicRaw = await fetchEventRanking(server, eventId, eventType, clientVersion, 1);
                            // medley music ranking uses scoreTopUsers/scoreBorderUsers at top level
                            const medleyMusic: MusicRankingBandoriRaw = {
                                musicId: 1,
                                scoreTopUsers: musicRaw.eventPointTopUsers,
                                scoreBorderUsers: musicRaw.eventPointBorderUsers,
                            };
                            await this.persistMusicTopSnapshot(server, eventId, 1, timestamp, medleyMusic);
                            await this.persistMusicBorderByTier(server, eventId, 1, timestamp, medleyMusic);
                        } catch (err) {
                            logger("eventRanking", `medley music fetch failed event=${eventId}: ${(err as Error)?.message || err}`);
                        }
                    }

                    logger("eventRanking", `stored event=${eventId} server=${server} type=${eventType}`);
                } catch (error) {
                    try {
                        const diag = await fetchEventRankingBuffer(server, eventId, eventType, clientVersion);
                        const prefix = diag.decrypted.subarray(0, 64).toString("hex");
                        logger("eventRanking", `diagnostic fetch server=${server} event=${eventId} status=${diag.status} prefix=${prefix}`);
                    } catch {
                        // ignore diagnostic errors
                    }
                    throw error;
                }
            },
            { timeoutMs: 2000 },
        );
    }

    // ========================================================================
    // Persistence — Event Top
    // ========================================================================

    private async persistEventTopSnapshot(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const users = raw.eventPointTopUsers ?? [];
        const newPoints = users.map((u) => ({ timestamp, uid: u.uid, value: u.point }));
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

    private async persistEventBorderByTier(server: number, eventId: number, timestamp: number, raw: EventRankingBandoriRaw): Promise<void> {
        const byTier = buildBorderBuckets(raw.eventPointBorderUsers, timestamp);
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

    private async persistMusicTopSnapshot(
        server: number,
        eventId: number,
        musicId: number,
        timestamp: number,
        musicRaw: MusicRankingBandoriRaw,
    ): Promise<void> {
        const users = musicRaw.scoreTopUsers ?? [];
        const newPoints = users.map((u) => ({ timestamp, uid: u.uid, value: u.point }));
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
    // Query — Event Top
    // ========================================================================

    async getEventTopSnapshot(server: number, eventId: number): Promise<EventRankingTopResponse> {
        const query = await eventTopCollection.find({ server, eventId });
        const records = await query.sort({ bucket: 1 }).toArray();
        if (records.length === 0) {
            return { points: [], users: [] };
        }

        const points = records.flatMap((record) => record.points ?? []);
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

    // ========================================================================
    // Query — Event Border
    // ========================================================================

    async getEventBorderPoints(server: number, eventId: number, tier: EventRankingBorderTier): Promise<EventRankingBorderResponse> {
        const record = await eventBorderCollection.findOne({ server, eventId, tier });
        if (!record) {
            return { result: true, cutoffs: [] };
        }

        return { result: record.result, cutoffs: record.cutoffs };
    }

    // ========================================================================
    // Query — Music Top
    // ========================================================================

    async getMusicTopSnapshot(server: number, eventId: number, musicId: number): Promise<MusicRankingTopResponse> {
        const query = await musicTopCollection.find({ server, eventId, musicId });
        const records = await query.sort({ bucket: 1 }).toArray();
        if (records.length === 0) {
            return { points: [], users: [] };
        }

        const points = records.flatMap((record) => record.points ?? []);
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

    // ========================================================================
    // Query — Music Border
    // ========================================================================

    async getMusicBorderPoints(server: number, eventId: number, musicId: number, tier: MusicRankingBorderTier): Promise<MusicRankingBorderResponse> {
        const record = await musicBorderCollection.findOne({ server, eventId, musicId, tier });
        if (!record) {
            return { result: true, cutoffs: [] };
        }

        return { result: record.result, cutoffs: record.cutoffs };
    }
}

export const eventRankingService = new EventRankingService();
