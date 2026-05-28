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

    private async collection(): Promise<Collection<Document>> {
        return this.database.getCollection(this.collectionName);
    }

    async findOne(filter: DatabaseFilter): Promise<TDocument | undefined> {
        const result = await (await this.collection()).findOne(filter as Filter<Document>);
        return (result ?? undefined) as TDocument | undefined;
    }

    async replaceOne(filter: DatabaseFilter, document: TDocument, options?: { upsert?: boolean }): Promise<void> {
        await (await this.collection()).replaceOne(filter as Filter<Document>, document as Document, { upsert: options?.upsert ?? false });
    }

    async updateOne(filter: DatabaseFilter, update: DatabaseUpdate, options?: { upsert?: boolean }): Promise<void> {
        await (await this.collection()).updateOne(filter as Filter<Document>, update as Document, { upsert: options?.upsert ?? false });
    }

    async find(filter: DatabaseFilter): Promise<DatabaseFindQuery<TDocument>> {
        return new MongoFindQuery<TDocument>((await this.collection()).find(filter as Filter<Document>));
    }
}

class MongoDatabase implements Database {
    private client: MongoClient | undefined;
    private status: "connecting" | "closed" | "connected" = "closed";
    private connectTask: Promise<MongoClient> | undefined;
    private reconnectTimer: NodeJS.Timeout | undefined;
    private db = undefined as unknown as import("mongodb").Db;

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.status === "connected") {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            if (this.status !== "connected") {
                void this.connect().catch(() => undefined);
            }
        }, MONGODB_RECONNECT_INTERVAL_MS);
    }

    private async connect(): Promise<MongoClient> {
        if (this.client && this.status === "connected") {
            return this.client;
        }

        if (this.status === "connecting" && this.connectTask) {
            return this.connectTask;
        }

        this.status = "connecting";
        const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: MONGODB_CONNECTION_TIMEOUT_MS });
        this.connectTask = client
            .connect()
            .then((connected) => {
                this.client = connected;
                this.db = connected.db(MONGODB_DB);
                this.status = "connected";
                this.clearReconnectTimer();
                logger("database", "mongodb connected");
                return connected;
            })
            .catch((error: unknown) => {
                this.client = undefined;
                this.db = undefined as unknown as import("mongodb").Db;
                this.connectTask = undefined;
                this.status = "closed";
                this.scheduleReconnect();
                const nodeError = error as { message?: string };
                logger("database", `mongodb connection failed: ${nodeError.message ?? "unknown error"}`);
                throw error;
            });

        return this.connectTask;
    }

    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument> {
        return new MongoCollection<TDocument>(this, name);
    }

    async close(): Promise<void> {
        if (!this.client) {
            this.status = "closed";
            this.connectTask = undefined;
            this.clearReconnectTimer();
            return;
        }

        await this.client.close();
        this.client = undefined;
        this.db = undefined as unknown as import("mongodb").Db;
        this.connectTask = undefined;
        this.status = "closed";
        this.clearReconnectTimer();
    }

    private async getDb(): Promise<import("mongodb").Db> {
        await this.connect();
        if (!this.db) {
            throw new Error("MongoDB not connected yet; await a database operation that triggers connection first");
        }
        return this.db;
    }

    async getCollection(name: string): Promise<Collection<Document>> {
        return (await this.getDb()).collection(name);
    }
}

export const database = new MongoDatabase();
