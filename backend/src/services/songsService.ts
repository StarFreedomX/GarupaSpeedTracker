import { fetchBestdoriSongs } from "@/api/bestdori";
import type { MusicDataResponse } from "@/types/bestdori/songs";

/**
 * Fetches the full song list from Bestdori.
 *
 * @returns The raw music data response from the Bestdori API.
 */
export const getSongsList = async (): Promise<MusicDataResponse> => {
    return await fetchBestdoriSongs();
};
