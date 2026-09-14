import seekBzip from "seek-bzip";
import { fetchJpSuiteMasterBuffer, getGarupaFallbackClientVersion, getGarupaPackageUrl } from "@/api/garupa";
import { parseGarupaMusic } from "@/parsers/GarupaMusicParser";
import { downloader } from "@/storage/downloader";
import type { MusicDataResponse } from "@/types/bestdori/songs";

/** Resolve a client version without waiting on the ranking service or MongoDB. */
async function getJpClientVersion(forceUpdate = false): Promise<string> {
    try {
        const data = await downloader.downloadCache<{ results?: { version?: string }[] }>(getGarupaPackageUrl(0), {
            forceUpdate,
            fallbackTtlMs: 5 * 60_000,
        });
        const version = data.results?.[0]?.version;
        if (version && /^\d+\.\d+\.\d+$/.test(version)) return version;
        throw new Error("JP client version lookup returned no version");
    } catch (error) {
        const fallback = getGarupaFallbackClientVersion(0);
        if (fallback) return fallback;
        throw error;
    }
}

export async function fetchGarupaSongs(): Promise<MusicDataResponse> {
    let compressed: Buffer;
    try {
        compressed = await fetchJpSuiteMasterBuffer(await getJpClientVersion());
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("HTTP 426")) throw error;
        compressed = await fetchJpSuiteMasterBuffer(await getJpClientVersion(true));
    }
    return parseGarupaMusic(seekBzip.decode(compressed));
}
