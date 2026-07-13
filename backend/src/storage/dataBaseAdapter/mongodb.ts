import { type Collection, type Document, type Filter, type FindCursor, MongoClient } from "mongodb";
import {
    MONGODB_CONNECT_TIMEOUT_MS,
    MONGODB_DB,
    MONGODB_RECONNECT_INTERVAL_MS,
    MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    MONGODB_STARTUP_RETRY_INTERVAL_MS,
    MONGODB_URI,
} from "@/config";
import { logger } from "@/logger";
import type { Database, DatabaseCollection, DatabaseFilter, DatabaseFindQuery, DatabaseProjection, DatabaseSort, DatabaseUpdate } from "@/storage/database";

/**
 * MongoDB implementation of {@link DatabaseFindQuery} wrapping a native FindCursor.
 */
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

/**
 * MongoDB implementation of {@link DatabaseCollection} delegating to a named collection.
 */
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

/**
 * MongoDB implementation of the {@link Database} interface.
 *
 * Handles automatic connection recovery: on construction it starts a background
 * retry loop, and reconnects when heartbeats fail. Callers can await
 * {@link ready} before issuing queries to ensure the database is available.
 */
class MongoDatabase implements Database {
    private client!: MongoClient;
    private db!: import("mongodb").Db;
    private connected = false;
    private recoveryPromise: Promise<void> | null = null;

    constructor() {
        this.initClient();
        // Start background recovery immediately — do not block module loading or server startup.
        this.startRecovery();
    }

    /** Creates or recreates the MongoClient instance. Called on retry after failures to get a clean connection state. */
    private initClient(): void {
        if (this.client) {
            this.client.removeAllListeners();
            try {
                void this.client.close();
            } catch {
                /* 忽略关闭失败 */
            }
        }

        this.client = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
            heartbeatFrequencyMS: MONGODB_RECONNECT_INTERVAL_MS,
            maxPoolSize: 10,
        });
        this.db = this.client.db(MONGODB_DB);

        this.connected = false;

        this.client.on("serverHeartbeatSucceeded", () => {
            if (!this.connected) {
                this.connected = true;
                logger("database", "mongodb connected.");
            }
        });

        this.client.on("serverHeartbeatFailed", () => {
            if (this.connected) {
                this.connected = false;
                logger("database", "mongodb connection lost.");
                // 连接断开后自动启动后台重试，防止 topology 进入 closed 后永久失效
                this.startRecovery();
            }
        });
    }

    /** Attempts to establish a connection and verify availability. Uses a short-timeout probe for fast failure, allowing the retry loop to respond quickly. */
    async connect(): Promise<void> {
        // Use a short-timeout probe to check whether the database is reachable,
        // avoiding the retry loop waiting for the full MONGODB_SERVER_SELECTION_TIMEOUT_MS each time.
        const probe = new MongoClient(MONGODB_URI, {
            serverSelectionTimeoutMS: MONGODB_CONNECT_TIMEOUT_MS,
            maxPoolSize: 1,
        });
        try {
            await probe.connect();
            await probe.db(MONGODB_DB).admin().ping();
        } finally {
            await probe.close();
        }

        // Probe passed — connect the main client (with normal serverSelectionTimeoutMS).
        await this.client.connect();
        await this.db.admin().ping();
        this.connected = true;
    }

    /**
     * Blocks until the database is ready, retrying automatically until timeout or success.
     * When `timeoutMs` is omitted the method retries indefinitely (used for background recovery).
     */
    async waitForReady(options?: { timeoutMs?: number; retryIntervalMs?: number }): Promise<void> {
        const timeout = options?.timeoutMs; // undefined = 无限重试
        const interval = options?.retryIntervalMs ?? MONGODB_STARTUP_RETRY_INTERVAL_MS;
        const startTime = Date.now();

        while (true) {
            try {
                await this.connect();
                logger("database", "mongodb ready for operations.");
                return;
            } catch (err: unknown) {
                const elapsed = Date.now() - startTime;
                const message = (err as { message?: string })?.message ?? String(err);

                if (timeout !== undefined && elapsed >= timeout) {
                    throw new Error(`MongoDB unavailable after ${elapsed}ms: ${message}`);
                }

                // Topology closed — recreate the client. For ordinary connection failures (e.g. ECONNREFUSED) a simple retry is sufficient.
                if (message.includes("Topology is closed")) {
                    logger("database", `mongodb topology closed, recreating client. retrying in ${interval}ms... (${Math.round(elapsed / 1000)}s elapsed)`);
                    this.initClient();
                } else {
                    logger("database", `mongodb not available (${message}), retrying in ${interval}ms... (${Math.round(elapsed / 1000)}s elapsed)`);
                }

                await new Promise((resolve) => setTimeout(resolve, interval));
            }
        }
    }

    /** Background retry loop with no timeout. Prevents concurrent recovery attempts. Called automatically during construction and on heartbeat loss. */
    private startRecovery(): void {
        if (this.connected || this.recoveryPromise) {
            return;
        }
        this.recoveryPromise = this.waitForReady()
            .then(() => {
                logger("database", "mongodb recovery succeeded.");
            })
            .catch((err: unknown) => {
                logger("database", `mongodb recovery failed: ${(err as Error)?.message ?? String(err)}`);
            })
            .finally(() => {
                this.recoveryPromise = null;
            });
    }

    /**
     * Returns a Promise that resolves when the database is ready.
     * Resolves immediately when already connected; otherwise waits for background recovery.
     * Services should `await database.ready()` before DB-dependent operations to avoid
     * errors due to an unavailable database at startup.
     */
    async ready(): Promise<void> {
        while (!this.connected) {
            if (!this.recoveryPromise) {
                this.startRecovery();
            }
            await this.recoveryPromise;
        }
    }

    /**
     * Returns a typed collection handle for the given name.
     */
    collection<TDocument = Record<string, unknown>>(name: string): DatabaseCollection<TDocument> {
        return new MongoCollection<TDocument>(this, name);
    }

    /**
     * Closes the underlying MongoClient connection.
     */
    async close(): Promise<void> {
        await this.client.close();
        logger("database", "mongodb connection closed");
    }

    /**
     * Renames a collection. No-op if the target name already exists.
     */
    async renameCollection(oldName: string, newName: string): Promise<void> {
        const existing = await this.db.listCollections({ name: newName }).toArray();
        if (existing.length > 0) {
            return;
        }
        await this.db.renameCollection(oldName, newName);
    }

    /**
     * Lists all collection names in the current database.
     */
    async listCollectionNames(): Promise<string[]> {
        return (await this.db.listCollections().toArray()).map((c) => c.name);
    }

    /**
     * Returns a raw MongoDB Collection handle for internal/advanced usage.
     */
    getCollectionRaw(name: string): Collection<Document> {
        return this.db.collection(name);
    }
}

/**
 * Singleton MongoDB database adapter instance.
 */
export const database = new MongoDatabase();
