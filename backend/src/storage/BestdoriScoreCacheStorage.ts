import { DISK_CACHE_CLEANUP_INTERVAL_MS, DISK_CACHE_MAX_BYTES, MEMORY_CACHE_MAX_BYTES, MEMORY_CACHE_MAX_ENTRIES, MIN_UPDATE_TIME } from "@/config";
import { BestdoriParser } from "@/parsers/BestdoriParser";
import { AbstractCacheStorage } from "@/storage/cache";
import type { BestdoriResponseRaw, ScoreQueryParams } from "@/types/bestdori";

type CacheParams = Pick<ScoreQueryParams, "server" | "eventId" | "interval">;

export class BestdoriScoreCacheStorage extends AbstractCacheStorage<ScoreQueryParams, BestdoriResponseRaw> {
    private readonly parser = new BestdoriParser();

    constructor() {
        super({
            memoryMaxEntries: MEMORY_CACHE_MAX_ENTRIES,
            memoryMaxBytes: MEMORY_CACHE_MAX_BYTES,
            diskMaxBytes: DISK_CACHE_MAX_BYTES,
            diskCleanupIntervalMs: DISK_CACHE_CLEANUP_INTERVAL_MS,
            staleAfterSeconds: MIN_UPDATE_TIME,
            serviceName: "bestdori",
            cacheName: "score-track",
            logScope: "cache",
        });
    }

    protected buildDiskPath(params: CacheParams): string {
        return this.buildDiskPathFromSegments(String(params.server), String(params.eventId), `interval-${params.interval}.json`);
    }

    protected isPayloadShape(payload: unknown): payload is BestdoriResponseRaw {
        if (!payload || typeof payload !== "object") {
            return false;
        }

        const value = payload as Partial<BestdoriResponseRaw>;
        return Array.isArray(value.points) && Array.isArray(value.users);
    }

    protected getMaxTimestamp(payload: BestdoriResponseRaw): number {
        return this.parser.getMaxTimestamp(payload);
    }
}
