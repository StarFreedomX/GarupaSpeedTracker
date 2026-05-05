import { DISK_CACHE_CLEANUP_INTERVAL_MS, DISK_CACHE_MAX_BYTES, MEMORY_CACHE_MAX_BYTES, MEMORY_CACHE_MAX_ENTRIES, MIN_UPDATE_TIME } from "@/config";
import { BestdoriParser } from "@/parsers/BestdoriParser";
import { AbstractCacheStorage } from "@/storage/cache";
import type { BestdoriTopPointsRaw, PointsQueryParams } from "@/types/bestdori";

type CacheParams = Pick<PointsQueryParams, "server" | "eventId" | "interval">;

export class BestdoriPointsCacheStorage extends AbstractCacheStorage<PointsQueryParams, BestdoriTopPointsRaw> {
    private readonly parser = new BestdoriParser();

    constructor() {
        super({
            memoryMaxEntries: MEMORY_CACHE_MAX_ENTRIES,
            memoryMaxBytes: MEMORY_CACHE_MAX_BYTES,
            diskMaxBytes: DISK_CACHE_MAX_BYTES,
            diskCleanupIntervalMs: DISK_CACHE_CLEANUP_INTERVAL_MS,
            staleAfterSeconds: MIN_UPDATE_TIME,
            serviceName: "bestdori",
            cacheName: "points-track",
            logScope: "cache",
        });
    }

    protected buildDiskPath(params: CacheParams): string {
        return this.buildDiskPathFromSegments(String(params.server), String(params.eventId), `interval-${params.interval}.json`);
    }

    protected isPayloadShape(payload: unknown): payload is BestdoriTopPointsRaw {
        if (!payload || typeof payload !== "object") {
            return false;
        }

        const value = payload as Partial<BestdoriTopPointsRaw>;
        return Array.isArray(value.points) && Array.isArray(value.users);
    }

    protected getMaxTimestamp(payload: BestdoriTopPointsRaw): number {
        return this.parser.getMaxTimestamp(payload);
    }
}
