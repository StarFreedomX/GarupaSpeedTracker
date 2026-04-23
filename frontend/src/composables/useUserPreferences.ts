import { reactive } from "vue";
import {
    DEFAULT_API_PREFERENCES,
    DEFAULT_AUTO_RETRY_DELAY_SECONDS,
    DEFAULT_EVENT,
    DEFAULT_PRIMARY_HUE,
    DEFAULT_REQUEST_INTERVAL_SECONDS,
    DEFAULT_REQUEST_MINUTE_INTERVAL,
    DEFAULT_REQUEST_MODE,
    DEFAULT_REQUEST_SECOND,
    DEFAULT_SAMPLE_INTERVAL_SECONDS,
    DEFAULT_SERVER,
    DEFAULT_TABLE_PREFERENCES,
    DEFAULT_TIME_MINUTES,
    PREFERENCES_STORAGE_KEY,
} from "@/config/config";
import type { ApiPreferences, QueryPreferences, RequestMode, TablePreferences, ThemePreferences, UserPreferences } from "@/types/preferences";

export const normalizeHue = (value: number): number => {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
};

const clampInteger = (value: unknown, fallback: number, min: number, max?: number): number => {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const next = Math.round(parsed);
    const lower = Math.max(min, next);
    return max === undefined ? lower : Math.min(lower, max);
};

const toRequestMode = (value: unknown): RequestMode => {
    return value === "fixed-interval" || value === "fixed-minute" || value === "smart-refresh" ? value : DEFAULT_REQUEST_MODE;
};

export const createDefaultPreferences = (): UserPreferences => ({
    api: {
        ...DEFAULT_API_PREFERENCES,
    },
    query: {
        server: DEFAULT_SERVER,
        event: DEFAULT_EVENT,
        sampleIntervalSeconds: DEFAULT_SAMPLE_INTERVAL_SECONDS,
        requestMode: DEFAULT_REQUEST_MODE,
        requestIntervalSeconds: DEFAULT_REQUEST_INTERVAL_SECONDS,
        requestMinuteInterval: DEFAULT_REQUEST_MINUTE_INTERVAL,
        requestSecond: DEFAULT_REQUEST_SECOND,
        requestAutoRetryDelaySeconds: DEFAULT_AUTO_RETRY_DELAY_SECONDS,
        time: DEFAULT_TIME_MINUTES,
    },
    table: {
        rowsPerPage: DEFAULT_TABLE_PREFERENCES.rowsPerPage,
    },
    theme: {
        primaryHue: DEFAULT_PRIMARY_HUE,
    },
});

export const clonePreferences = (preferences: UserPreferences): UserPreferences => ({
    api: {
        ...preferences.api,
    },
    query: {
        ...preferences.query,
    },
    table: {
        ...preferences.table,
    },
    theme: {
        ...preferences.theme,
    },
});

const defaultPreferences = createDefaultPreferences();

const normalizeQueryPreferences = (query: Record<string, unknown> | undefined): QueryPreferences => {
    const legacyIntervalMs = query?.interval !== undefined ? clampInteger(query.interval, DEFAULT_SAMPLE_INTERVAL_SECONDS * 1000, 1) : undefined;

    return {
        server: clampInteger(query?.server, defaultPreferences.query.server, 0, 4) as QueryPreferences["server"],
        event: clampInteger(query?.event, defaultPreferences.query.event, 1),
        sampleIntervalSeconds:
            query?.sampleIntervalSeconds !== undefined
                ? clampInteger(query.sampleIntervalSeconds, defaultPreferences.query.sampleIntervalSeconds, 1)
                : legacyIntervalMs !== undefined
                  ? Math.max(1, Math.round(legacyIntervalMs / 1000))
                  : defaultPreferences.query.sampleIntervalSeconds,
        requestMode: toRequestMode(query?.requestMode),
        requestIntervalSeconds: clampInteger(query?.requestIntervalSeconds, defaultPreferences.query.requestIntervalSeconds, 1),
        requestMinuteInterval: clampInteger(query?.requestMinuteInterval, defaultPreferences.query.requestMinuteInterval, 1),
        requestSecond: clampInteger(query?.requestSecond, defaultPreferences.query.requestSecond, 0, 59),
        requestAutoRetryDelaySeconds: clampInteger(query?.requestAutoRetryDelaySeconds, defaultPreferences.query.requestAutoRetryDelaySeconds, 1),
        time: clampInteger(query?.time, defaultPreferences.query.time, 2),
    };
};

const normalizeTablePreferences = (table: Record<string, unknown> | undefined): TablePreferences => ({
    rowsPerPage: clampInteger(table?.rowsPerPage, defaultPreferences.table.rowsPerPage, 1),
});

const normalizeApiPreferences = (api: Record<string, unknown> | undefined): ApiPreferences => ({
    mode: api?.mode === "backend" ? "backend" : DEFAULT_API_PREFERENCES.mode,
    backendBaseUrl: typeof api?.backendBaseUrl === "string" ? api.backendBaseUrl.trim() : DEFAULT_API_PREFERENCES.backendBaseUrl,
});

const loadPreferences = (): UserPreferences => {
    try {
        const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
        if (!raw) {
            return defaultPreferences;
        }

        const parsed = JSON.parse(raw) as Partial<UserPreferences>;
        return {
            api: normalizeApiPreferences(parsed.api as Record<string, unknown> | undefined),
            query: normalizeQueryPreferences(parsed.query as Record<string, unknown> | undefined),
            table: normalizeTablePreferences(parsed.table as Record<string, unknown> | undefined),
            theme: {
                primaryHue: normalizeHue(clampInteger(parsed.theme?.primaryHue, defaultPreferences.theme.primaryHue, 0, 359)),
            },
        };
    } catch {
        return createDefaultPreferences();
    }
};

const applyTheme = (theme: ThemePreferences): void => {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--color-primary-h", String(normalizeHue(theme.primaryHue)));
};

export const useUserPreferences = () => {
    const preferences = reactive<UserPreferences>(clonePreferences(loadPreferences()));

    const persist = () => {
        localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    };

    return {
        preferences,
        applyTheme,
        persist,
    };
};
