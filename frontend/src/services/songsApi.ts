import { translate } from "@/i18n";
import { getApiBase } from "@/services/apiBase";
import type { MusicDataResponse } from "@/types/songs";

export const fetchSongList = async (): Promise<MusicDataResponse> => {
    const response = await fetch(`${getApiBase()}/songs`);
    if (!response.ok) {
        throw new Error(translate("error.requestFailed", { status: response.status }));
    }

    return (await response.json()) as MusicDataResponse;
};
