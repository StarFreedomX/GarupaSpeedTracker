import { translate } from "@/i18n";
import { getApiBase } from "@/services/apiBase";
import type { SongChartMeta } from "@/types/songMetadata";

export const fetchMetadata = async (): Promise<SongChartMeta> => {

    const response = await fetch(`${getApiBase()}/songMetadata.json`);
    if (!response.ok) {
        throw new Error(translate("error.requestFailed", { status: response.status }));
    }

    return (await response.json()) as SongChartMeta;
};
