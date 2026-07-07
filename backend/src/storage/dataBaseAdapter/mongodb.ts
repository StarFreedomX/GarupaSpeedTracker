import { type Collection, type Document, type Filter, type FindCursor, MongoClient } from "mongodb";
import { MONGODB_CONNECTION_TIMEOUT_MS, MONGODB_DB, MONGODB_RECONNECT_INTERVAL_MS, MONGODB_URI } from "@/config";
import { logger } from "@/logger";
import type { Database, DatabaseCollection, DatabaseFilter, DatabaseFindQuery, DatabaseProjection, DatabaseSort, DatabaseUpdate } from "@/storage/database";

class MongoFindQuery<TDocument> implements DatabaseFindQuery<TDocument> {
    constructor(private readonly cursor: FindCursor<Document>) {}

    project<TProjection extends Record<string, unknown>>(projection: DatabaseProjection<TDocument>): DatabaseFindQuery<TProjection> {
        return new MongoFindQuery<TProjection>(this.cursor.project(projection as Record<string, 0 | 1>));
    }

    sort(sort: DatabaseSort): DatabaseFindQuery<TDocument> {
        return new MongoFindQuery<TDocument>(this.cursor.sort(sort));
    }

    async toArray(): Promise<TDocument[]> {
        return (await this.cursor.toArray()) as TDocument[];
    }

    async first(): Promise<TDocument | undefined> {
        const result = await this.cursor.limit(1).next();
        return (result ?? undefined) as TDocument | undefined;
    }
}

class MongoCollection<TDocument> implements DatabaseCollection<TDocument> {
    constructor(
        private readonly database: MongoDatabase,
        private readonly collectionName: string,
    ) {}

    private collection(): Collection<Document> {
        return this.database.getCollectionRaw(this.collectionName);
    }

    async findOne(filter: DatabaseFilter, options?: { projection?: DatabaseProjection<TDocument> }): Promise<TDocument | undefined> {
        const result = await this.collection().findOne(
            filter as Filter<Document>,
            options ? { projection: options.projection as Record<string, 0 | 1> } : undefined,
        );
        return (result ?? undefined) as TDocument | undefined;
    }

    async replaceOne(filter: DatabaseFilter, document: TDocument, options?: { upsert?: boolean }): Promise<void> {
        await this.collection().replaceOne(filter as Filter<Document>, document as Document, { upsert: options?.upsert ?? false });
    }

    async updateOne(filter: DatabaseFilter, update: DatabaseUpdate, options?: { upsert?: boolean }): Promise<void> {
        await this.collection().updateOne(filter as Filter<Document>, update as Document, { upsert: options?.upsert ?? false });
    }

    async find(filter: DatabaseFilter): Promise<DatabaseFindQuery<TDocument>> {
        return new MongoFindQuery<TDocument>(this.collection().find(filter as Filter<Document>));
    }
}

class MongoDatabase implements Database {
    private readonly client: MongoClient;
    private readonly db: import("mongodb").Db;

    constructor() {
        // 驱动 v6+ 支持 lazy connect：不需要显式调用 connect()。
        // 首次操作时驱动自动连接，之后 SDAM 持续监控，断线自动恢复。
        this.client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS,
            heartbeatFrequencyMS: MONGODB_RECONNECT_INTERVAL_MS,
            maxPoolSize: 10,
        });
        this.db = this.client.db(MONGODB_DB);

        let connected = false; // 标记当前连接状态，避免重复日志

        // 心跳成功 → 连接正常（仅状态变化时打印）
        this.client.on("serverHeartbeatSucceeded", () => {
            if (!connected) {
                connected = true;
                logger("database", "mongodb connected.");
            }
        });

        // 心跳失败 → 连接断开（仅状态变化时打印）
        this.client.on("serverHeartbeatFailed", () => {
            if (connected) {
                connected = false;
                logger("database", "mongodb connection lost.");
            }
        });
    }

    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument> {
        return new MongoCollection<TDocument>(this, name);
    }

    async close(): Promise<void> {
        await this.client.close();
        logger("database", "mongodb connection closed");
    }

    async renameCollection(oldName: string, newName: string): Promise<void> {
        const existing = await this.db.listCollections({ name: newName }).toArray();
        if (existing.length > 0) {
            return;
        }
        await this.db.renameCollection(oldName, newName);
    }

    async listCollectionNames(): Promise<string[]> {
        return (await this.db.listCollections().toArray()).map((c) => c.name);
    }

    getCollectionRaw(name: string): Collection<Document> {
        return this.db.collection(name);
    }
}

export const database = new MongoDatabase();
