import { type Collection, type Document, type Filter, type FindCursor, MongoClient } from "mongodb";
import { MONGODB_CONNECTION_TIMEOUT_MS, MONGODB_DB, MONGODB_URI } from "@/config";
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
    private client: MongoClient | undefined;
    private db = undefined as unknown as import("mongodb").Db;
    private initPromise: Promise<void> | undefined;

    constructor() {
        this.ensureConnected().catch(() => undefined);
    }

    /**
     * 💡 核心优化：利用 MongoClient 的自身机制维护长连接
     * 只要 client 创建了，后续任何查询失败它会自动进行内置重连，不需要我们用定时器去维护 status
     */
    private async ensureConnected(): Promise<void> {
        if (this.client) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            try {
                const client = new MongoClient(MONGODB_URI, {
                    serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS,
                    maxPoolSize: 10,
                });

                await client.connect();
                this.client = client;
                this.db = client.db(MONGODB_DB);
                logger("database", "mongodb connected");
            } catch (error) {
                this.initPromise = undefined;
                const nodeError = error as { message?: string };
                logger("database", `mongodb connection failed: ${nodeError.message ?? "unknown error"}`);
                throw error;
            }
        })();

        return this.initPromise;
    }

    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument> {
        return new MongoCollection<TDocument>(this, name);
    }

    async close(): Promise<void> {
        this.initPromise = undefined;
        if (this.client) {
            await this.client.close();
            this.client = undefined;
            this.db = undefined as unknown as import("mongodb").Db;
            logger("database", "mongodb connection closed");
        }
    }

    getCollectionRaw(name: string): Collection<Document> {
        if (!this.db) {
            void this.ensureConnected().catch(() => undefined);
            const tempClient = this.client || new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS });
            if (!this.client) this.client = tempClient; // 复用实例

            return tempClient.db(MONGODB_DB).collection(name);
        }

        return this.db.collection(name);
    }
}

export const database = new MongoDatabase();
