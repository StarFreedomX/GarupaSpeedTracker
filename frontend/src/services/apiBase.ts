import { API_BASE_DEFAULT } from "@/config/config";
import type { ApiPreferences } from "@/types/preferences";

let currentApiBase = API_BASE_DEFAULT;

export const normalizeApiBase = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
        return API_BASE_DEFAULT;
    }

    return trimmed.replace(/\/+$/, "");
};

export const resolveApiBase = (api: ApiPreferences): string => {
    if (api.mode === "frontend") {
        return API_BASE_DEFAULT;
    }

    return normalizeApiBase(api.backendBaseUrl);
};

export const setApiBase = (api: ApiPreferences): void => {
    currentApiBase = resolveApiBase(api);
};

export const getApiBase = (): string => currentApiBase;
