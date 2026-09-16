import path from "node:path";
import fs from "fs-extra";
import { fetchBestdoriSongs } from "@/api/bestdori";
import { fetchGarupaSongs } from "@/api/garupaMusic";
import { BESTDORI_SONGS_CHECK_INTERVAL_MS } from "@/config";
import { logger } from "@/logger";
import type { MusicDataResponse } from "@/types/bestdori/songs";

/** Fill absent fields/region slots only; JP values (including 0 and "") always win. */
function supplement(primary: unknown, extra: unknown): unknown {
    if (primary === undefined || primary === null) return extra ?? primary;
    if (Array.isArray(primary) && Array.isArray(extra)) {
        return Array.from({ length: Math.max(primary.length, extra.length) }, (_, index) => supplement(primary[index], extra[index]));
    }
    if (typeof primary === "object" && !Array.isArray(primary) && typeof extra === "object" && extra !== null && !Array.isArray(extra)) {
        const result = { ...(extra as Record<string, unknown>) };
        for (const [key, value] of Object.entries(primary)) result[key] = supplement(value, result[key]);
        return result;
    }
    return primary;
}

/** The JP catalog and chart availability are authoritative; Bestdori adds metadata. */
export function supplementJpSongs(jp: MusicDataResponse, bestdori: MusicDataResponse): MusicDataResponse {
    return Object.fromEntries(
        Object.entries(jp).map(([id, song]) => {
            const merged = structuredClone(supplement(song, bestdori[id])) as MusicDataResponse[string];
            merged.difficulty = Object.fromEntries(
                Object.entries(song.difficulty).map(([key, difficulty]) => [
                    key,
                    supplement(difficulty, bestdori[id]?.difficulty[key as keyof typeof song.difficulty]),
                ]),
            ) as typeof song.difficulty;
            return [id, merged];
        }),
    );
}

interface Snapshot {
    version: 1;
    checkedAt: number;
    songs: MusicDataResponse;
}

export class SongsService {
    private snapshot?: Snapshot;
    private pending?: Promise<MusicDataResponse>;

    constructor(
        private readonly dataDir = path.resolve(process.cwd(), "data"),
        private readonly fetchJp = fetchGarupaSongs,
        private readonly fetchSupplement = fetchBestdoriSongs,
        private readonly intervalMs = BESTDORI_SONGS_CHECK_INTERVAL_MS,
    ) {}

    getSongsList(): Promise<MusicDataResponse> {
        if (this.pending) return this.pending;
        this.pending = this.load().finally(() => {
            this.pending = undefined;
        });
        return this.pending;
    }

    private async load(): Promise<MusicDataResponse> {
        const file = path.join(this.dataDir, "jpSongs.json");
        if (!this.snapshot) {
            try {
                const stored = (await fs.readJson(file)) as Snapshot;
                if (stored.version === 1 && stored.checkedAt > 0 && Object.keys(stored.songs ?? {}).length > 0) this.snapshot = stored;
            } catch {
                /* First run or invalid cache: fetch the JP masters. */
            }
        }
        if (this.snapshot && this.intervalMs > 0 && Date.now() - this.snapshot.checkedAt < this.intervalMs) return this.snapshot.songs;

        try {
            const jp = await this.fetchJp();
            let bestdori: MusicDataResponse = {};
            try {
                bestdori = await this.fetchSupplement();
            } catch (error) {
                logger("songs", `Bestdori supplement unavailable: ${String(error)}`, "warn");
                bestdori = this.snapshot?.songs ?? {};
            }
            const songs = supplementJpSongs(jp, bestdori);
            const next: Snapshot = { version: 1, checkedAt: Date.now(), songs };
            await fs.ensureDir(this.dataDir);
            await fs.writeJson(`${file}.tmp`, next);
            await fs.move(`${file}.tmp`, file, { overwrite: true });
            this.snapshot = next;
            return songs;
        } catch (error) {
            if (!this.snapshot) throw error;
            logger("songs", `JP refresh failed; retaining last JP snapshot: ${String(error)}`, "warn");
            return this.snapshot.songs;
        }
    }
}

export const songsService = new SongsService();
export const getSongsList = (): Promise<MusicDataResponse> => songsService.getSongsList();
