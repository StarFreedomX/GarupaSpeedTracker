import { translate } from "@/i18n";
import { getApiBase } from "@/services/apiBase";
import type { EventListResponse } from "@/types/event";

export const fetchEventList = async (): Promise<EventListResponse> => {
    const response = await fetch(`${getApiBase()}/events`);
    if (!response.ok) {
        throw new Error(translate("error.requestFailed", { status: response.status }));
    }

    return (await response.json()) as EventListResponse;
};
