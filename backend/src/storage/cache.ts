import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "@/logger";
import { toMs } from "@/utils";

interface MemoryEntry<TPayload> {
    maxTimestamp: number;
    payload: TPayload;
    payloadBytes: number;
    lastAccessedAt: number;
}

interface DiskCacheFile<TPayload> {
    version: 1;
    key: string;
    maxTimestamp: number;
    payload: TPayload;
    payloadBytes: number;
    cachedAt: number;
}

export interface CachedPayload<TPayload> {
    payload: TPayload;
    maxTimestamp: number;
    payloadBytes: number;
}

/**
 * The source from which a cached payload was retrieved.
 */
export type CacheSource = "memory" | "disk";

interface CacheOptions {
    memoryMaxEntries: number;
    memoryMaxBytes: number;
    diskMaxBytes: number;
    diskCleanupIntervalMs: number;
    staleAfterSeconds: number;
    serviceName: string;
    cacheName: string;
    cacheBaseDir?: string;
    logScope?: string;
}

/**
 * Abstract two-level cache that stores payloads in memory (LRU) and on disk.
 *
 * Memory layer uses an LRU eviction policy based on last-access time. Disk layer
 * persists cache entries as JSON files under a service-specific directory tree.
 * A periodic cleanup thread prunes the disk cache when total bytes exceed the
 * configured limit, evicting oldest (by mtime) files first.
 *
 * Subclasses implement {@link buildDiskPath}, {@link isPayloadShape}, and
 * {@link getMaxTimestamp} to customise storage layout and staleness logic.
 *
 * @typeParam TParams - Lookup parameters used to derive the disk file path.
 * @typeParam TPayload - The cached value type.
 */
export abstract class AbstractCacheStorage<TParams, TPayload> {
    private readonly cache = new Map<string, MemoryEntry<TPayload>>();
    private readonly logScope: string;
    private readonly diskRootDir: string;
    private memoryCacheBytes = 0;
    private diskCleanupPromise: Promise<void> | undefined;

    protected constructor(private readonly options: CacheOptions) {
        this.logScope = options.logScope ?? "cache";
        const cacheBaseDir = options.cacheBaseDir ?? path.resolve(process.cwd(), "cache");
        this.diskRootDir = path.join(cacheBaseDir, "services", options.serviceName, options.cacheName);

        if (this.options.diskCleanupIntervalMs > 0) {
            const cleanupTimer = setInterval(() => {
                this.scheduleDiskCleanup();
            }, this.options.diskCleanupIntervalMs);
            cleanupTimer.unref();
        }
    }

    /**
     * Formats a byte count as a human-readable string (MB and raw bytes).
     */
    static formatBytes(value: number): string {
        return `${(value / 1024 / 1024).toFixed(2)}MB (${value.toLocaleString()} bytes)`;
    }

    /**
     * Returns the number of entries currently held in the in-memory LRU cache.
     */
    getMemoryEntryCount(): number {
        return this.cache.size;
    }

    /**
     * Retrieves a cached payload by params and key.
     *
     * Checks the in-memory LRU cache first (fast path). On a miss, reads from the
     * disk cache; if found on disk the entry is also promoted to memory. Returns
     * `undefined` when neither tier has a valid, non-stale entry.
     *
     * @returns The cached payload with its source, or `undefined` on a miss.
     */
    async get(params: TParams, key: string): Promise<{ source: CacheSource; entry: CachedPayload<TPayload> } | undefined> {
        const memoryCached = this.getMemoryEntry(key);
        if (memoryCached) {
            return {
                source: "memory",
                entry: {
                    payload: memoryCached.payload,
                    maxTimestamp: memoryCached.maxTimestamp,
                    payloadBytes: memoryCached.payloadBytes,
                },
            };
        }

        const diskCached = await this.readDiskEntry(params, key);
        if (!diskCached) {
            return undefined;
        }

        const entry = this.setMemoryEntry(key, diskCached);
        return {
            source: "disk",
            entry: {
                payload: entry.payload,
                maxTimestamp: entry.maxTimestamp,
                payloadBytes: entry.payloadBytes,
            },
        };
    }

    /**
     * Stores a payload in both memory and disk tiers.
     *
     * The entry is inserted into the LRU memory cache and persisted to disk.
     * Disk writes are best-effort — failures are logged but do not reject the
     * caller. After a successful disk write a cleanup cycle is scheduled.
     *
     * @returns The stored payload (same shape as the input).
     */
    async set(params: TParams, key: string, entry: CachedPayload<TPayload>): Promise<CachedPayload<TPayload>> {
        const stored = this.setMemoryEntry(key, entry);

        try {
            await this.writeDiskEntry(params, key, entry);
            this.scheduleDiskCleanup();
        } catch (error: unknown) {
            const nodeError = error as { message?: string };
            logger(this.logScope, `disk write failed ${key}: ${nodeError.message ?? "unknown error"}`);
        }

        return {
            payload: stored.payload,
            maxTimestamp: stored.maxTimestamp,
            payloadBytes: stored.payloadBytes,
        };
    }

    /**
     * Returns the on-disk file path for the given lookup parameters.
     *
     * Implementations should return a deterministic, collision-free path.
     */
    protected abstract buildDiskPath(params: TParams): string;

    /**
     * Type guard that validates whether an unknown value matches the expected
     * payload shape. Used to verify disk-loaded data before returning it.
     */
    protected abstract isPayloadShape(payload: unknown): payload is TPayload;

    /**
     * Extracts a comparable timestamp (Unix epoch ms) from a payload.
     *
     * Used together with {@link shouldReuse} to determine staleness.
     */
    protected abstract getMaxTimestamp(payload: TPayload): number;

    /**
     * Convenience helper to join path segments under the disk root directory.
     */
    protected buildDiskPathFromSegments(...segments: string[]): string {
        return path.join(this.diskRootDir, ...segments);
    }

    /**
     * Computes the UTF-8 byte length of a serialised payload. Used for memory
     * and disk budget accounting.
     */
    protected payloadBytesOf(payload: TPayload): number {
        return Buffer.byteLength(JSON.stringify(payload), "utf8");
    }

    /**
     * Returns `true` when a cached entry's max timestamp is still within the
     * configured {@link CacheOptions.staleAfterSeconds} threshold.
     */
    protected shouldReuse(maxTimestamp: number): boolean {
        if (!maxTimestamp) {
            return false;
        }

        const ageMs = Date.now() - toMs(maxTimestamp);
        return ageMs < this.options.staleAfterSeconds * 1000;
    }

    private deleteMemoryEntry(key: string): void {
        const existing = this.cache.get(key);
        if (!existing) {
            return;
        }

        this.memoryCacheBytes = Math.max(0, this.memoryCacheBytes - existing.payloadBytes);
        this.cache.delete(key);
    }

    private enforceMemoryLimit(): void {
        while (this.cache.size > this.options.memoryMaxEntries || this.memoryCacheBytes > this.options.memoryMaxBytes) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }

            this.deleteMemoryEntry(oldestKey);
        }
    }

    private setMemoryEntry(key: string, result: CachedPayload<TPayload>): MemoryEntry<TPayload> {
        this.deleteMemoryEntry(key);

        const entry: MemoryEntry<TPayload> = {
            maxTimestamp: result.maxTimestamp,
            payload: result.payload,
            payloadBytes: result.payloadBytes,
            lastAccessedAt: Date.now(),
        };

        this.cache.set(key, entry);
        this.memoryCacheBytes += entry.payloadBytes;
        this.enforceMemoryLimit();
        return entry;
    }

    private getMemoryEntry(key: string): MemoryEntry<TPayload> | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        if (!this.shouldReuse(entry.maxTimestamp)) {
            this.deleteMemoryEntry(key);
            return undefined;
        }

        // Touch on hit for LRU eviction order.
        this.cache.delete(key);
        entry.lastAccessedAt = Date.now();
        this.cache.set(key, entry);
        return entry;
    }

    private async unlinkIfExists(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger(this.logScope, `failed to remove cache file ${filePath}: ${nodeError.message ?? "unknown error"}`);
            }
        }
    }

    private async readDiskEntry(params: TParams, key: string): Promise<CachedPayload<TPayload> | undefined> {
        const filePath = this.buildDiskPath(params);

        let raw: string;
        try {
            raw = await fs.readFile(filePath, "utf8");
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger(this.logScope, `disk read failed ${filePath}: ${nodeError.message ?? "unknown error"}`);
            }
            return undefined;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            logger(this.logScope, `invalid disk cache json ${filePath}, deleting`);
            await this.unlinkIfExists(filePath);
            return undefined;
        }

        const record = parsed as Partial<DiskCacheFile<TPayload>>;
        if (!record || typeof record !== "object" || !record.payload || !this.isPayloadShape(record.payload)) {
            logger(this.logScope, `invalid disk cache shape ${filePath}, deleting`);
            await this.unlinkIfExists(filePath);
            return undefined;
        }

        const maxTimestamp = typeof record.maxTimestamp === "number" ? record.maxTimestamp : this.getMaxTimestamp(record.payload);
        const payloadBytes = typeof record.payloadBytes === "number" ? record.payloadBytes : this.payloadBytesOf(record.payload);

        if (!this.shouldReuse(maxTimestamp)) {
            await this.unlinkIfExists(filePath);
            return undefined;
        }

        try {
            const now = new Date();
            await fs.utimes(filePath, now, now);
        } catch {
            // atime/mtime touch is best-effort for disk eviction ordering.
        }

        if (record.key && record.key !== key) {
            logger(this.logScope, `disk key mismatch for ${filePath}, expected ${key}, got ${record.key}`);
        }

        return {
            payload: record.payload,
            maxTimestamp,
            payloadBytes,
        };
    }

    private async writeDiskEntry(params: TParams, key: string, result: CachedPayload<TPayload>): Promise<void> {
        const filePath = this.buildDiskPath(params);
        const directory = path.dirname(filePath);

        const diskEntry: DiskCacheFile<TPayload> = {
            version: 1,
            key,
            maxTimestamp: result.maxTimestamp,
            payload: result.payload,
            payloadBytes: result.payloadBytes,
            cachedAt: Date.now(),
        };

        const tempPath = `${filePath}.tmp`;

        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(tempPath, JSON.stringify(diskEntry), "utf8");
        await fs.rename(tempPath, filePath);
    }

    private async collectDiskFiles(directory: string): Promise<Array<{ filePath: string; size: number; mtimeMs: number }>> {
        const files: Array<{ filePath: string; size: number; mtimeMs: number }> = [];
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                const nested = await this.collectDiskFiles(fullPath);
                files.push(...nested);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith(".json")) {
                continue;
            }

            try {
                const stats = await fs.stat(fullPath);
                files.push({ filePath: fullPath, size: stats.size, mtimeMs: stats.mtimeMs });
            } catch {
                // Ignore files disappearing during cleanup scans.
            }
        }

        return files;
    }

    private async cleanupDiskCache(): Promise<void> {
        if (this.options.diskMaxBytes <= 0) {
            return;
        }

        let files: Array<{ filePath: string; size: number; mtimeMs: number }>;
        try {
            files = await this.collectDiskFiles(this.diskRootDir);
        } catch (error: unknown) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
                logger(this.logScope, `disk cleanup scan failed: ${nodeError.message ?? "unknown error"}`);
            }
            return;
        }

        let total = files.reduce((sum, file) => sum + file.size, 0);
        if (total <= this.options.diskMaxBytes) {
            return;
        }

        files = files.sort((a, b) => a.mtimeMs - b.mtimeMs);
        for (const file of files) {
            if (total <= this.options.diskMaxBytes) {
                break;
            }

            try {
                await fs.unlink(file.filePath);
                total -= file.size;
            } catch {
                // Best-effort cleanup: continue evicting other files.
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
                logger(this.logScope, `disk cleanup failed: ${nodeError.message ?? "unknown error"}`);
            })
            .finally(() => {
                this.diskCleanupPromise = undefined;
            });
    }
}
