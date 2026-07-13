/**
 * Migrates `timestamp` → `time` in points arrays across all top-points collections.
 *
 * Idempotent: checks for a marker in the garupa_meta collection before running.
 * Each document's `points` array is transformed via `$map`, renaming the
 * `timestamp` field to `time` while preserving `uid` and `value`.
 */
import {
    MONGODB_EVENT_TOP_POINTS_COLLECTION,
    MONGODB_GARUPA_META_COLLECTION,
    MONGODB_MONTHLY_TOP_POINTS_COLLECTION,
    MONGODB_MUSIC_TOP_POINTS_COLLECTION,
} from "@/config";
import { logger } from "@/logger";
import { database } from "@/storage/dataBaseAdapter/mongodb";
import type { GarupaMetaDocument } from "@/types/garupaMeta";

const MIGRATION_KEY = "timestamp-to-time";

const topPointCollections = [MONGODB_EVENT_TOP_POINTS_COLLECTION, MONGODB_MUSIC_TOP_POINTS_COLLECTION, MONGODB_MONTHLY_TOP_POINTS_COLLECTION];

export async function migrateTimestampToTime(): Promise<void> {
    await database.ready();

    const metaCol = database.collection<GarupaMetaDocument>(MONGODB_GARUPA_META_COLLECTION);

    // Check if already applied
    const marker = await metaCol.findOne({ type: "migration", key: MIGRATION_KEY });
    if (marker) {
        logger("migration", `"${MIGRATION_KEY}" already applied at ${new Date(marker.updatedAt).toISOString()}`);
        return;
    }

    logger("migration", `starting "${MIGRATION_KEY}"...`);

    for (const colName of topPointCollections) {
        const col = database.collection(colName);
        const result = await col.updateMany({}, [
            {
                $set: {
                    points: {
                        $map: {
                            input: { $ifNull: ["$points", []] },
                            as: "p",
                            in: {
                                time: { $ifNull: ["$$p.time", "$$p.timestamp", 0] },
                                uid: "$$p.uid",
                                value: "$$p.value",
                            },
                        },
                    },
                },
            },
        ]);
        logger("migration", `  ${colName}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
    }

    // Insert marker
    await metaCol.insertOne({
        type: "migration",
        key: MIGRATION_KEY,
        server: -1,
        clientVersion: "",
        updatedAt: Date.now(),
    } satisfies GarupaMetaDocument);

    logger("migration", `"${MIGRATION_KEY}" complete.`);
}
