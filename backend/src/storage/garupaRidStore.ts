import type { DatabaseCollection } from "@/storage/database";

export const GARUPA_RID_COLLECTION = "garupa_request_ids";
export interface RidState {
    _id: number;
    nonce: string;
}

export async function loadRidState(collection: DatabaseCollection<RidState>, server: number, initial?: string): Promise<string | undefined> {
    return (await collection.findOne({ _id: server }))?.nonce ?? initial;
}

export async function saveRidState(collection: DatabaseCollection<RidState>, server: number, nonce: string): Promise<void> {
    await collection.updateOne({ _id: server }, { $set: { nonce } }, { upsert: true });
}
