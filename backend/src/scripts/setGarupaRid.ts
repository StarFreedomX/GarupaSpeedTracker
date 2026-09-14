import { MongoClient } from "mongodb";
import { MONGODB_DB, MONGODB_URI } from "@/config";
import { GARUPA_RID_COLLECTION, type RidState } from "@/storage/garupaRidStore";

async function main() {
    const [serverArg, nonce, ...extra] = process.argv.slice(2);
    if (!serverArg || !/^\d+$/.test(serverArg) || !nonce || !/^[a-f0-9]{32}$/i.test(nonce) || extra.length) {
        throw new Error("Usage: pnpm rid:set <server> <32-hex response nonce> (CN server: 3)");
    }
    const server = Number(serverArg);
    if (!Number.isSafeInteger(server)) throw new Error("Invalid server index");
    const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    try {
        await client.connect();
        await client
            .db(MONGODB_DB)
            .collection<RidState>(GARUPA_RID_COLLECTION)
            .updateOne(
                { _id: server },
                { $set: { nonce } },
                { upsert: true },
            );
        console.log(`Persisted RID nonce for server=${server}. The next ranking request will read it; no restart required.`);
    } finally {
        await client.close();
    }
}
main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
});
