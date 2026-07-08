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
    private client!: MongoClient;
    private db!: import("mongodb").Db;
    private connected = false;
    private recoveryPromise: Promise<void> | null = null;

    constructor() {
        this.initClient();
        // 构造时立即启动后台重试——不阻塞模块加载和服务启动
        this.startRecovery();
    }

    /** 创建/重建 MongoClient 实例。失败后重试时也会调用此方法以获得干净的连接状态。 */
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

    /** 尝试建立连接并验证可用性。使用短超时探针快速失败，便于重试循环及时响应。 */
    async connect(): Promise<void> {
        // 先用短超时探针检测数据库是否可达，避免重试循环每次等 MONGODB_SERVER_SELECTION_TIMEOUT_MS
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

        // 探针通过后，连接主客户端（使用正常的 serverSelectionTimeoutMS）
        await this.client.connect();
        await this.db.admin().ping();
        this.connected = true;
    }

    /**
     * 阻塞等待数据库就绪，自动重试直到超时或成功。
     * 不传 timeoutMs 则无限重试（用于后台恢复）。
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

                // 拓扑已关闭时需要重建客户端；普通连接失败（如 ECONNREFUSED）直接重试即可
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

    /** 后台无限重试连接，防止并发重复启动。构造时和心跳断线时自动调用。 */
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
     * 返回一个在数据库就绪时 resolve 的 Promise。
     * 已连接时立即返回；未连接时等待后台恢复完成。
     * 服务在需要 DB 的操作前 await database.ready() 可避免启动时因数据库未就绪而报错。
     */
    async ready(): Promise<void> {
        while (!this.connected) {
            if (!this.recoveryPromise) {
                this.startRecovery();
            }
            await this.recoveryPromise;
        }
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
