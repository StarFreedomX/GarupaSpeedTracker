import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import axios from "axios";
import {
    BESTDORI_TIMEOUT_MS,
    DISK_CACHE_CLEANUP_INTERVAL_MS,
    DISK_CACHE_MAX_BYTES,
    INFO_CACHE_TIME,
    MEMORY_CACHE_MAX_BYTES,
    MEMORY_CACHE_MAX_ENTRIES,
} from "@/config";
import { logger } from "@/logger";

interface DownloadCacheEntry<T> {
    key: string;
    url: string;
    body: T;
    payloadBytes: number;
    cachedAt: number;
    expireAt: number;
}

interface DiskDownloadCacheEntry<T> extends DownloadCacheEntry<T> {
    version: 1;
}

interface DiskDownloadMetaEntry {
    version: 2;
    key: string;
    url: string;
    payloadBytes: number;
    cachedAt: number;
    expireAt: number;
}

interface MemoryDownloadCacheEntry<T> {
    entry: DownloadCacheEntry<T>;
    lastAccessedAt: number;
}

export interface DownloadCacheOptions<T> {
    getExpireAt?: (body: T) => number;
    /** 后台异步刷新缓存（仍返回当前缓存数据） */
    backUpdate?: boolean;
    /** 强制抓取并更新缓存（忽略已有缓存） */
    forceUpdate?: boolean;
    allowExpired?: boolean;
    fallbackTtlMs?: number;
}

interface ReadCacheResult<T> {
    source: "memory" | "disk";
    entry: DownloadCacheEntry<T>;
    isExpired: boolean;
}

const defaultTtlMs = INFO_CACHE_TIME * 1000;

const axiosClient = axios.create({
    timeout: BESTDORI_TIMEOUT_MS,
    httpAgent: new http.Agent({
        keepAlive: true,
        keepAliveMsecs: 30_000, // 空闲 30s 后关闭 socket
        maxSockets: 10, // 限制每个 host 最大连接数
        maxFreeSockets: 5, // 限制空闲 socket 数量
        timeout: 30_000, // socket 超时
    }),
    httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 30_000,
        maxSockets: 10,
        maxFreeSockets: 5,
        timeout: 30_000,
    }),
});

const toCacheKey = (url: string): string => {
    const normalized = new URL(url);
    normalized.hash = "";
    return normalized.toString();
};

const toCachePath = (key: string): string => {
    const parsed = new URL(key);
    const protocol = parsed.protocol.replace(":", "") || "https";
    const host = encodeURIComponent(parsed.host.toLowerCase());
    const rawSegments = parsed.pathname.split("/").filter(Boolean);
    const safeSegments = rawSegments.map((segment) => encodeURIComponent(segment));
    const baseDir = path.resolve(process.cwd(), "cache", "downloads", protocol, host);

    const leaf = safeSegments.pop() ?? "index";
    const hasQuery = parsed.search.length > 0;
    const querySuffix = hasQuery ? `--${createHash("sha1").update(parsed.search).digest("hex").slice(0, 12)}` : "";
    const fileName = `${leaf}${querySuffix}.json`;

    return path.join(baseDir, ...safeSegments, fileName);
};

const toMetaPath = (key: string): string => toCachePath(key).replace(/\.json$/, ".meta.json");

class Downloader {
    private readonly memory = new Map<string, MemoryDownloadCacheEntry<unknown>>();
    private readonly inFlight = new Map<string, Promise<DownloadCacheEntry<unknown>>>();
    private memoryBytes = 0;
    private diskCleanupPromise: Promise<void> | undefined;

    constructor() {
        if (DISK_CACHE_CLEANUP_INTERVAL_MS > 0) {
            const cleanupTimer = setInterval(() => {
                this.scheduleDiskCleanup();
            }, DISK_CACHE_CLEANUP_INTERVAL_MS);
            cleanupTimer.unref();
        }
    }

    public async download<T>(url: string): Promise<T> {
        logger("bestdori", `fetching ${url}`);

        try {
            const response = await axiosClient.get<T>(url);
            return response.data;
        } catch (error: unknown) {
            const axiosError = error as { code?: string; message?: string };
            logger("bestdori", `upstream request failed: ${axiosError.message ?? "unknown error"}`);

            const upstreamError = new Error("Bestdori upstream request failed") as Error & { status?: number };
            upstreamError.status = axiosError.code === "ECONNABORTED" ? 504 : 502;
            throw upstreamError;
        }
    }

    public async downloadCache<T>(url: string, options?: DownloadCacheOptions<T>): Promise<T> {
        const key = toCacheKey(url);

        // forceUpdate：跳过缓存，强制抓取并写入
        if (options?.forceUpdate) {
            const fresh = await this.fetchAndStore<T>(key, options);
            return fresh.body;
        }

        const cached = await this.readCacheEntry<T>(key);

        if (cached) {
            if (!cached.isExpired) {
                if (options?.backUpdate) {
                    this.refreshInBackground(key, options);
                }
                return cached.entry.body;
            }

            if (options?.allowExpired) {
                this.refreshInBackground(key, options);
                return cached.entry.body;
            }
        }

        const fresh = await this.fetchAndStore<T>(key, options);
        return fresh.body;
    }

    public formatBytes(value: number): string {
        return `${(value / 1024 / 1024).toFixed(2)}MB (${value.toLocaleString()} bytes)`;
    }

    private refreshInBackground<T>(key: string, options?: DownloadCacheOptions<T>): void {
        this.fetchAndStore<T>(key, options).catch((error: unknown) => {
            const err = error as { message?: string };
            logger("cache", `background refresh failed ${key}: ${err.message ?? "unknown error"}`);
        });
    }

    private async fetchAndStore<T>(key: string, options?: DownloadCacheOptions<T>): Promise<DownloadCacheEntry<T>> {
        const active = this.inFlight.get(key);
        if (active) {
            return active as Promise<DownloadCacheEntry<T>>;
        }

        const request = this.download<T>(key)
            .then(async (body) => {
                const entry = this.buildEntry<T>(key, body, options);
                this.setMemoryEntry<T>(key, entry);

                try {
                    await this.writeDiskEntry<T>(key, entry);
                    this.scheduleDiskCleanup();
                } catch (error: unknown) {
                    const nodeError = error as { message?: string };
                    logger("cache", `disk write failed ${key}: ${nodeError.message ?? "unknown error"}`);
                }

                return entry;
            })
            .finally(() => {
                this.inFlight.delete(key);
            });

        this.inFlight.set(key, request as Promise<DownloadCacheEntry<unknown>>);
        return request;
    }

    private buildEntry<T>(key: string, body: T, options?: DownloadCacheOptions<T>): DownloadCacheEntry<T> {
        const now = Date.now();
        const payloadBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
        const computedExpireAt = options?.getExpireAt?.(body);
        const ttl = options?.fallbackTtlMs ?? defaultTtlMs;
        const expireAt = Number.isFinite(computedExpireAt) ? Number(computedExpireAt) : now + ttl;

        return {
            key,
            url: key,
            body,
            payloadBytes,
            cachedAt: now,
            expireAt,
        };
    }

    private isExpired(entry: DownloadCacheEntry<unknown>): boolean {
        return Date.now() >= entry.expireAt;
    }

    private touchMemoryEntry(key: string, entry: MemoryDownloadCacheEntry<unknown>): void {
        this.memory.delete(key);
        entry.lastAccessedAt = Date.now();
        this.memory.set(key, entry);
    }

    private deleteMemoryEntry(key: string): void {
        const existing = this.memory.get(key);
        if (!existing) {
            return;
        }

        this.memoryBytes = Math.max(0, this.memoryBytes - existing.entry.payloadBytes);
        this.memory.delete(key);
    }

    private enforceMemoryLimit(): void {
        while (this.memory.size > MEMORY_CACHE_MAX_ENTRIES || this.memoryBytes > MEMORY_CACHE_MAX_BYTES) {
            const oldestKey = this.memory.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }

            this.deleteMemoryEntry(oldestKey);
        }
    }

    private setMemoryEntry<T>(key: string, entry: DownloadCacheEntry<T>): void {
        this.deleteMemoryEntry(key);

        this.memory.set(key, {
            entry,
            lastAccessedAt: Date.now(),
        });
        this.memoryBytes += entry.payloadBytes;
        this.enforceMemoryLimit();
    }

    private async readCacheEntry<T>(key: string): Promise<ReadCacheResult<T> | undefined> {
        const memoryCached = this.memory.get(key);
        if (memoryCached) {
            this.touchMemoryEntry(key, memoryCached);
            return {
                source: "memory",
                entry: memoryCached.entry as DownloadCacheEntry<T>,
                isExpired: this.isExpired(memoryCached.entry),
            };
        }

        const diskCached = await this.readDiskEntry<T>(key);
        if (!diskCached) {
            return undefined;
        }

        this.setMemoryEntry(key, diskCached.entry);
        return diskCached;
    }

    private async readDiskEntry<T>(key: string): Promise<ReadCacheResult<T> | undefined> {
        const bodyPath = toCachePath(key);
        const metaPath = toMetaPath(key);

        const meta = await this.readDiskMetaEntry(metaPath);
        if (meta) {
            const body = await this.readDiskBodyEntry<T>(bodyPath);
            if (body === undefined) {
                await this.unlinkIfExists(bodyPath);
                await this.unlinkIfExists(metaPath);
                return undefined;
            }

            const entry: DownloadCacheEntry<T> = {
                key: meta.key,
                url: meta.url,
                body,
                payloadBytes: meta.payloadBytes,
                cachedAt: meta.cachedAt,
                expireAt: meta.expireAt,
            };

            try {
                const now = new Date();
                await fs.utimes(bodyPath, now, now);
                await fs.utimes(metaPath, now, now);
            } catch {
                // atime/mtime touch is best-effort for disk eviction order.
            }

            return {
                source: "disk",
                entry,
                isExpired: this.isExpired(entry),
            };
        }

        const legacy = await this.readLegacyDiskEntry<T>(bodyPath, key);
        if (!legacy) {
            await this.unlinkIfExists(metaPath);
            return undefined;
        }

        return legacy;
    }

    private async readDiskMetaEntry(filePath: string): Promise<DiskDownloadMetaEntry | undefined> {
        let raw: string;
        try {
            raw = await fs.readFile(filePath, "utf8");
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger("cache", `disk read failed ${filePath}: ${nodeError.message ?? "unknown error"}`);
            }
            return undefined;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            await this.unlinkIfExists(filePath);
            return undefined;
        }

        const record = parsed as Partial<DiskDownloadMetaEntry>;
        if (
            !record ||
            typeof record !== "object" ||
            record.version !== 2 ||
            typeof record.key !== "string" ||
            typeof record.url !== "string" ||
            typeof record.payloadBytes !== "number" ||
            typeof record.cachedAt !== "number" ||
            typeof record.expireAt !== "number"
        ) {
            await this.unlinkIfExists(filePath);
            return undefined;
        }

        return {
            version: 2,
            key: record.key,
            url: record.url,
            payloadBytes: record.payloadBytes,
            cachedAt: record.cachedAt,
            expireAt: record.expireAt,
        };
    }

    private async readDiskBodyEntry<T>(filePath: string): Promise<T | undefined> {
        let raw: string;
        try {
            raw = await fs.readFile(filePath, "utf8");
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger("cache", `disk read failed ${filePath}: ${nodeError.message ?? "unknown error"}`);
            }
            return undefined;
        }

        try {
            return JSON.parse(raw) as T;
        } catch {
            await this.unlinkIfExists(filePath);
            return undefined;
        }
    }

    private async readLegacyDiskEntry<T>(filePath: string, key: string): Promise<ReadCacheResult<T> | undefined> {
        const body = await this.readDiskBodyEntry<unknown>(filePath);
        if (body === undefined) {
            return undefined;
        }

        const record = body as Partial<DiskDownloadCacheEntry<T>>;
        if (!record || typeof record !== "object" || record.version !== 1 || record.key !== key || !("body" in record)) {
            return undefined;
        }

        const entry: DownloadCacheEntry<T> = {
            key: record.key,
            url: typeof record.url === "string" ? record.url : record.key,
            body: record.body as T,
            payloadBytes: typeof record.payloadBytes === "number" ? record.payloadBytes : Buffer.byteLength(JSON.stringify(record.body), "utf8"),
            cachedAt: typeof record.cachedAt === "number" ? record.cachedAt : Date.now(),
            expireAt: typeof record.expireAt === "number" ? record.expireAt : Date.now(),
        };

        try {
            const now = new Date();
            await fs.utimes(filePath, now, now);
        } catch {
            // atime/mtime touch is best-effort for disk eviction order.
        }

        return {
            source: "disk",
            entry,
            isExpired: this.isExpired(entry),
        };
    }

    private async writeDiskEntry<T>(key: string, entry: DownloadCacheEntry<T>): Promise<void> {
        const bodyPath = toCachePath(key);
        const metaPath = toMetaPath(key);
        const directory = path.dirname(bodyPath);
        const bodyTempPath = `${bodyPath}.tmp`;
        const metaTempPath = `${metaPath}.tmp`;

        const metaRecord: DiskDownloadMetaEntry = {
            version: 2,
            key: entry.key,
            url: entry.url,
            payloadBytes: entry.payloadBytes,
            cachedAt: entry.cachedAt,
            expireAt: entry.expireAt,
        };

        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(bodyTempPath, JSON.stringify(entry.body), "utf8");
        await fs.writeFile(metaTempPath, JSON.stringify(metaRecord), "utf8");
        await fs.rename(bodyTempPath, bodyPath);
        await fs.rename(metaTempPath, metaPath);
    }

    private async unlinkIfExists(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger("cache", `failed to remove cache file ${filePath}: ${nodeError.message ?? "unknown error"}`);
            }
        }
    }

    private async collectDiskFiles(directory: string): Promise<Array<{ bodyPath: string; metaPath: string; size: number; mtimeMs: number }>> {
        const files: Array<{ bodyPath: string; metaPath: string; size: number; mtimeMs: number }> = [];
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = await this.collectDiskFiles(fullPath);
                files.push(...nested);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".meta.json")) {
                continue;
            }

            try {
                const stats = await fs.stat(fullPath);
                const metaPath = fullPath.replace(/\.json$/, ".meta.json");
                let size = stats.size;
                let mtimeMs = stats.mtimeMs;

                try {
                    const metaStats = await fs.stat(metaPath);
                    size += metaStats.size;
                    mtimeMs = Math.max(mtimeMs, metaStats.mtimeMs);
                } catch {
                    // Meta file may not exist for legacy cache entries.
                }

                files.push({ bodyPath: fullPath, metaPath, size, mtimeMs });
            } catch {
                // Ignore files that disappear during cleanup scans.
            }
        }

        return files;
    }

    private async cleanupDiskCache(): Promise<void> {
        if (DISK_CACHE_MAX_BYTES <= 0) {
            return;
        }

        let files: Array<{ bodyPath: string; metaPath: string; size: number; mtimeMs: number }>;
        try {
            files = await this.collectDiskFiles(path.resolve(process.cwd(), "cache", "downloads"));
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger("cache", `disk cleanup scan failed: ${nodeError.message ?? "unknown error"}`);
            }
            return;
        }

        let total = files.reduce((sum, file) => sum + file.size, 0);
        if (total <= DISK_CACHE_MAX_BYTES) {
            return;
        }

        files = files.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const file of files) {
            if (total <= DISK_CACHE_MAX_BYTES) {
                break;
            }

            try {
                await this.unlinkIfExists(file.bodyPath);
                await this.unlinkIfExists(file.metaPath);
                total -= file.size;
            } catch {
                // Best-effort cleanup: continue with remaining files.
            }
        }
    }

    private scheduleDiskCleanup(): void {
        if (this.diskCleanupPromise) {
            return;
        }

        this.diskCleanupPromise = this.cleanupDiskCache()
            .catch((error: unknown) => {
                const nodeError = error as { message?: string };
                logger("cache", `disk cleanup failed: ${nodeError.message ?? "unknown error"}`);
            })
            .finally(() => {
                this.diskCleanupPromise = undefined;
            });
    }
}

export const downloader = new Downloader();
