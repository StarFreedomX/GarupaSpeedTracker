import { fetchBestdoriSongs } from "@/api/bestdori";
import type { MusicDataResponse } from "@/types/bestdori/songs";

export const getSongsList = async (): Promise<MusicDataResponse> => {
    return await fetchBestdoriSongs();
};
