import type { database } from "@/storage/dataBaseAdapter/mongodb";
import type { RankingUser } from "@/types/rankingUser";

/**
 * Shared persistence helpers for replacing point/cutoff entries within
 * MongoDB bucket/border documents, plus nullable-array merge utilities.
 * Both the event and monthly ranking services use the same atomic
 * replace-or-skip logic and array merge helpers, so the implementations
 * live here to avoid duplication.
 *
 * @module rankingPersistenceHelpers
 */

// ============================================================================
// Nullable-array helpers
// ============================================================================

/**
 * Creates an array of the given length, filled with the provided fallback value,
 * then copies any non-null entries from the input array into the result.
 *
 * @param input - Source array, may be undefined.
 * @param length - Desired length of the returned array.
 * @param fillValue - Value used for uninitialized or missing slots.
 * @returns A fixed-length array with existing values copied in place.
 */
export const toNullableArray = <T>(input: Array<T | null> | undefined, length: number, fillValue: T | null): Array<T | null> => {
    const out = Array.from({ length }, () => fillValue);
    if (!input) {
        return out;
    }
    for (let i = 0; i < Math.min(input.length, length); i++) {
        out[i] = input[i] ?? fillValue;
    }
    return out;
};

/**
 * Merges an existing nullable array with an update, preserving existing non-null
 * values and overwriting only where the update provides a non-null entry.
 *
 * @param existing - The current array (may be undefined).
 * @param update - The update array to merge on top.
 * @param length - Fixed length of the resulting array.
 * @returns A merged array of the given length.
 */
export const mergeNullableArray = <T>(existing: Array<T | null> | undefined, update: Array<T | null>, length: number): Array<T | null> => {
    const merged = toNullableArray(existing, length, null);
    for (let i = 0; i < Math.min(update.length, length); i++) {
        if (update[i] !== null) {
            merged[i] = update[i];
        }
    }
    return merged;
};

// ============================================================================
// Atomic replace helpers
// ============================================================================

/**
 * Generic atomic replace-or-skip for array entries in a bucket/border document.
 *
 * Reads the existing document, compares entries matching the given timestamp
 * against the new ones via the provided {@code equals} comparator, and skips
 * the write entirely when they are identical.  Otherwise, atomically
 * ({@code $filter} + {@code $concatArrays}) removes old entries at this
 * timestamp and appends the new ones in a single {@code updateOne} pipeline.
 *
 * @typeParam T - The type of each replacement entry.
 * @param collection      MongoDB collection holding the target document.
 * @param filter          Query filter identifying the target document.
 * @param arrayField      Name of the array field in the document (`"points"` or `"cutoffs"`).
 * @param timestampField  Name of the timestamp property inside each entry (`"timestamp"` or `"time"`).
 * @param timestamp       Timestamp whose existing entries should be replaced.
 * @param newEntries      Replacement entries (must include a timestamp property).
 * @param equals          Comparator: returns {@code true} when an old entry matches a new one at the same index.
 */
async function replaceEntriesInBucket<T extends Record<string, unknown>>(
    collection: ReturnType<typeof database.collection>,
    filter: Record<string, unknown>,
    arrayField: string,
    timestampField: string,
    timestamp: number,
    newEntries: T[],
    equals: (oldEntry: Record<string, unknown>, newEntry: T, index: number) => boolean,
): Promise<void> {
    const existing = (await collection.findOne(filter)) as Record<string, unknown> | undefined;
    if (existing && Array.isArray(existing[arrayField])) {
        const arr = existing[arrayField] as Array<Record<string, unknown>>;
        const oldEntries = arr.filter((e) => e[timestampField] === timestamp);
        if (oldEntries.length === newEntries.length && oldEntries.every((old, i) => equals(old, newEntries[i], i))) {
            return; // no change
        }
    }

    await collection.updateOne(
        filter,
        [
            {
                $set: {
                    [arrayField]: {
                        $concatArrays: [
                            {
                                $filter: {
                                    input: { $ifNull: [`$${arrayField}`, []] },
                                    as: "item",
                                    cond: { $ne: [`$$item.${timestampField}`, timestamp] },
                                },
                            },
                            { $literal: newEntries },
                        ],
                    },
                    updatedAt: { $literal: Date.now() },
                },
            },
        ],
        { upsert: true },
    );
}

/**
 * Replaces point entries in a bucket document at the given timestamp.
 *
 * Points carry {@code uid} / {@code value} pairs and use {@code timestamp}
 * as their time field.
 *
 * @param collection   MongoDB collection that holds the bucket documents.
 * @param filter       Query filter identifying the target document.
 * @param timestamp    Timestamp whose existing entries should be replaced.
 * @param newPoints    Replacement point entries (time, uid, value).
 */
export async function replacePointsInBucket(
    collection: ReturnType<typeof database.collection>,
    filter: Record<string, unknown>,
    timestamp: number,
    newPoints: Array<{ time: number; uid: number; value: number }>,
): Promise<void> {
    return replaceEntriesInBucket(
        collection,
        filter,
        "points",
        "time",
        timestamp,
        newPoints,
        (old, entry) => old.uid === entry.uid && old.value === entry.value,
    );
}

/**
 * Replaces cutoff entries in a border document at the given timestamp.
 *
 * Cutoffs use {@code time} as their timestamp field and carry an {@code ep}
 * value for comparison.
 *
 * @param collection   MongoDB collection that holds the border documents.
 * @param filter       Query filter identifying the target document.
 * @param timestamp    Timestamp whose existing cutoffs should be replaced.
 * @param newCutoffs   Replacement cutoff entries (time, ep).
 */
export async function replaceCutoffsInBucket(
    collection: ReturnType<typeof database.collection>,
    filter: Record<string, unknown>,
    timestamp: number,
    newCutoffs: Array<{ time: number; ep: number }>,
): Promise<void> {
    return replaceEntriesInBucket(collection, filter, "cutoffs", "time", timestamp, newCutoffs, (old, entry) => old.ep === entry.ep);
}

// ============================================================================
// Shared query helpers
// ============================================================================

/**
 * Builds a top ranking snapshot from bucket documents.
 *
 * Queries all bucket documents matching the filter, flattens and sorts point
 * records by timestamp, deduplicates UIDs, and resolves associated player
 * metadata from the shared player collection.
 *
 * @param bucketCollection  The MongoDB bucket collection (e.g. eventTopCollection, musicTopCollection, topCollection).
 * @param playerCollection  The shared player collection for resolving user metadata.
 * @param filter            MongoDB filter object identifying the ranking scope.
 * @param server            The server ID for player lookup.
 * @returns                 Combined points array and player metadata.
 */
export async function buildTopSnapshot(
    bucketCollection: ReturnType<typeof database.collection>,
    playerCollection: ReturnType<typeof database.collection>,
    filter: Record<string, unknown>,
    server: number,
): Promise<{ points: Array<{ time: number; uid: number; value: number }>; users: RankingUser[] }> {
    const query = await bucketCollection.find(filter);
    const records = await query.sort({ bucket: 1 }).toArray();
    if (records.length === 0) {
        return { points: [], users: [] };
    }

    const rawRows = records.flatMap((record) => ((record as Record<string, unknown>).points as Array<Record<string, unknown>>) ?? []);
    const points: Array<{ time: number; uid: number; value: number }> = rawRows.map((p) => ({
        time: (p.time ?? p.timestamp ?? 0) as number,
        uid: p.uid as number,
        value: p.value as number,
    }));
    points.sort((a, b) => a.time - b.time);

    const uidSet = new Set(points.map((p) => p.uid));
    const uids = Array.from(uidSet);

    let users: RankingUser[] = [];
    if (uids.length > 0) {
        const playerQuery = await playerCollection.find({ server, uid: { $in: uids } });
        const docs = await playerQuery.toArray();
        users = (docs as Array<Record<string, unknown>>).map((doc) => {
            const { server: _s, updatedAt: _u, _id, ...player } = doc;
            return player as unknown as RankingUser;
        });
    }

    return { points, users };
}

/**
 * Retrieves border cutoff history from a border collection.
 *
 * Returns cutoffs sorted by time, or an empty result if no record exists.
 *
 * @param borderCollection  The MongoDB border collection (e.g. eventBorderCollection, musicBorderCollection, borderCollection).
 * @param filter            MongoDB filter object identifying the ranking scope and tier.
 * @returns                 Border cutoff data with sorted time series.
 */
export async function queryBorderPoints(
    borderCollection: ReturnType<typeof database.collection>,
    filter: Record<string, unknown>,
): Promise<{ result: boolean; cutoffs: Array<{ time: number; ep: number }> }> {
    const record = await borderCollection.findOne(filter);
    if (!record) {
        return { result: true, cutoffs: [] };
    }

    const doc = record as { result: boolean; cutoffs: Array<{ time: number; ep: number }> };
    doc.cutoffs.sort((a, b) => a.time - b.time);
    return { result: doc.result, cutoffs: doc.cutoffs };
}
