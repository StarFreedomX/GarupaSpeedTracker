import type { ServerKey } from "@/types/score";

// Application configuration constants

type RuntimeConfig = Partial<{
    API_BASE_DEFAULT: string;
    DEFAULT_SERVER: string;
    DEFAULT_EVENT: string;
    DEFAULT_SAMPLE_INTERVAL_SECONDS: string;
    DEFAULT_REQUEST_MODE: string;
    DEFAULT_REQUEST_INTERVAL_SECONDS: string;
    DEFAULT_AUTO_RETRY_DELAY_SECONDS: string;
    DEFAULT_REQUEST_MINUTE_INTERVAL: string;
    DEFAULT_REQUEST_SECOND: string;
    DEFAULT_TIME_MINUTES: string;
    DEFAULT_ROWS_PER_PAGE: string;
    DEFAULT_PRIMARY_HUE: string;
    DEFAULT_API_MODE: string;
    DEFAULT_API_BACKEND_BASE_URL: string;
}>;

type RuntimeStringKey = keyof Pick<
    RuntimeConfig,
    "API_BASE_DEFAULT" | "DEFAULT_REQUEST_MODE" | "DEFAULT_API_MODE" | "DEFAULT_API_BACKEND_BASE_URL"
>;

type RuntimeNumberKey = keyof Pick<
    RuntimeConfig,
    | "DEFAULT_SERVER"
    | "DEFAULT_EVENT"
    | "DEFAULT_SAMPLE_INTERVAL_SECONDS"
    | "DEFAULT_REQUEST_INTERVAL_SECONDS"
    | "DEFAULT_AUTO_RETRY_DELAY_SECONDS"
    | "DEFAULT_REQUEST_MINUTE_INTERVAL"
    | "DEFAULT_REQUEST_SECOND"
    | "DEFAULT_TIME_MINUTES"
    | "DEFAULT_ROWS_PER_PAGE"
    | "DEFAULT_PRIMARY_HUE"
>;

const getRuntimeConfig = (): RuntimeConfig => {
    if (typeof window === "undefined") {
        return {};
    }

    return window.__GARUPA_RUNTIME_CONFIG__ ?? {};
};

const runtimeConfig = getRuntimeConfig();

const readRuntimeString = (key: RuntimeStringKey, fallback: string): string => {
    const value = runtimeConfig[key];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }

    return fallback;
};

const readRuntimeNumber = (key: RuntimeNumberKey, fallback: number, min?: number, max?: number): number => {
    const value = runtimeConfig[key];
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const rounded = Math.round(parsed);
    const lower = min === undefined ? rounded : Math.max(min, rounded);
    return max === undefined ? lower : Math.min(lower, max);
};

const readRuntimeRequestMode = (fallback: "fixed-interval" | "fixed-minute" | "smart-refresh"): "fixed-interval" | "fixed-minute" | "smart-refresh" => {
    const value = readRuntimeString("DEFAULT_REQUEST_MODE", fallback);
    return value === "fixed-interval" || value === "fixed-minute" || value === "smart-refresh" ? value : fallback;
};

const readRuntimeApiMode = (fallback: "frontend" | "backend"): "frontend" | "backend" => {
    const value = readRuntimeString("DEFAULT_API_MODE", fallback);
    return value === "frontend" || value === "backend" ? value : fallback;
};

const readRuntimeServerKey = (fallback: ServerKey): ServerKey => {
    return readRuntimeNumber("DEFAULT_SERVER", fallback, 0, 4) as ServerKey;
};

// API
export const API_BASE_DEFAULT = readRuntimeString("API_BASE_DEFAULT", "/api");

// User preferences defaults
// Query defaults control the initial score polling behavior and settings page defaults.
export const DEFAULT_SERVER = readRuntimeServerKey(0);
export const DEFAULT_EVENT = readRuntimeNumber("DEFAULT_EVENT", 328, 1);
// 数据采样间隔：请求时带给后端的采样步长，单位为秒。
export const DEFAULT_SAMPLE_INTERVAL_SECONDS = readRuntimeNumber("DEFAULT_SAMPLE_INTERVAL_SECONDS", 30, 1);
// 默认请求模式：固定分钟的固定时刻。
export const DEFAULT_REQUEST_MODE = readRuntimeRequestMode("smart-refresh");
// 固定时间间隔模式下的默认请求间隔，单位为秒。
export const DEFAULT_REQUEST_INTERVAL_SECONDS = readRuntimeNumber("DEFAULT_REQUEST_INTERVAL_SECONDS", 60, 1);
// 智能刷新模式下的重试间隔，单位为秒；当请求失败时，至少等待这个时间后再尝试下一次请求。
export const DEFAULT_AUTO_RETRY_DELAY_SECONDS = readRuntimeNumber("DEFAULT_AUTO_RETRY_DELAY_SECONDS", 30, 1);
// 固定分钟模式下的默认分钟间隔，1 表示每分钟都请求。
export const DEFAULT_REQUEST_MINUTE_INTERVAL = readRuntimeNumber("DEFAULT_REQUEST_MINUTE_INTERVAL", 1, 1);
// 固定分钟模式下的默认请求秒数，0 表示整分钟执行。
export const DEFAULT_REQUEST_SECOND = readRuntimeNumber("DEFAULT_REQUEST_SECOND", 0, 0, 59);
export const DEFAULT_TIME_MINUTES = readRuntimeNumber("DEFAULT_TIME_MINUTES", 60, 2);
// 表格分页默认每页行数。
export const DEFAULT_ROWS_PER_PAGE = readRuntimeNumber("DEFAULT_ROWS_PER_PAGE", 60, 1);
export const DEFAULT_TABLE_PREFERENCES = {
    rowsPerPage: DEFAULT_ROWS_PER_PAGE,
} as const;
// API 请求默认使用前端同源的基础地址；切换到后端模式时由用户手动填写完整的后端 API 基址。
export const DEFAULT_API_MODE = readRuntimeApiMode("frontend");
// 后端 API 基址默认留空，需在设置页中手动填写完整地址，例如 /api 或 /api/v2。
export const DEFAULT_API_BACKEND_BASE_URL = readRuntimeString("DEFAULT_API_BACKEND_BASE_URL", "");
export const DEFAULT_API_PREFERENCES = {
    mode: DEFAULT_API_MODE,
    backendBaseUrl: DEFAULT_API_BACKEND_BASE_URL,
} as const;
export const DEFAULT_PRIMARY_HUE = readRuntimeNumber("DEFAULT_PRIMARY_HUE", 340, 0, 359);

// Storage
export const PREFERENCES_STORAGE_KEY = "garupa-speed-tracker:preferences";

// UI constants
export const TOOLTIP_DELAY_MS = 120;
export const TOOLTIP_OFFSET_PX = 8;
export const TOOLTIP_MARGIN_PX = 8;
