import dotenv from "dotenv";

// Prefer local overrides first, then fallback to shared env defaults.
dotenv.config({ path: [".env.local", ".env", ".env.example"] });

const toNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
};

const toList = (value: string | undefined, fallback: string[]): string[] => {
    if (!value) {
        return fallback;
    }

    const entries = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : fallback;
};

export const BESTDORI_API = process.env.BESTDORI_API ?? "https://bestdori.com/api/";

export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = toNumber(process.env.PORT, 5519);
export const API_PREFIX = process.env.API_PREFIX ?? "/api";

// Seconds: if newest Bestdori point is newer than this threshold, reuse cache.
export const MIN_POINTS_UPDATE_TIME = toNumber(process.env.MIN_POINTS_UPDATE_TIME, 45);

// Seconds: 静态信息（卡牌/技能/活动等）的缓存时间
export const INFO_CACHE_TIME = toNumber(process.env.INFO_CACHE_TIME, 12 * 3600);

// 连接失败超时时间，单位ms
export const BESTDORI_TIMEOUT_MS = toNumber(process.env.BESTDORI_TIMEOUT_MS, 10_000);

// Two-level cache limits.
export const MEMORY_CACHE_MAX_ENTRIES = toNumber(process.env.MEMORY_CACHE_MAX_ENTRIES, 24);
export const MEMORY_CACHE_MAX_BYTES = toNumber(process.env.MEMORY_CACHE_MAX_BYTES, 256 * 1024 * 1024);
export const DISK_CACHE_MAX_BYTES = toNumber(process.env.DISK_CACHE_MAX_BYTES, 1024 * 1024 * 1024);
export const DISK_CACHE_CLEANUP_INTERVAL_MS = toNumber(process.env.DISK_CACHE_CLEANUP_INTERVAL_MS, 5 * 60 * 1000);

export const BESTDORI_SONGS_CHECK_INTERVAL_MS = toNumber(process.env.BESTDORI_SONGS_CHECK_INTERVAL_MS, 24 * 60 * 60 * 1000);
export const BESTDORI_STORE_RAW_CHARTS = toBoolean(process.env.BESTDORI_STORE_RAW_CHARTS, false);

export const DEFAULT_INTERVAL = 30_000;

export const ENABLE_CORS = toBoolean(process.env.ENABLE_CORS, false);
export const APP_PROXY = toBoolean(process.env.APP_PROXY, false);

export const GARUPA_SERVER_BASES = toList(process.env.GARUPA_SERVER_BASES, ["-", "-", "-", "-"]);
export const GARUPA_UIDS = toList(process.env.GARUPA_UIDS, ["-", "-", "-", "-"]);
export const GARUPA_UUIDS = toList(process.env.GARUPA_UUIDS, ["-", "-", "-", "-"]);
export const GARUPA_CLIENT_VERSIONS = toList(process.env.GARUPA_CLIENT_VERSIONS ?? process.env.GARUPA_CLIENT_VERSION, ["10.1.3", "-", "-", "-"]);
export const GARUPA_UNITY_VERSIONS = toList(process.env.GARUPA_UNITY_VERSIONS ?? process.env.GARUPA_UNITY_VERSION, ["2021.3.45f2", "-", "-", "2022.3.62f3c1"]);
export const GARUPA_USER_AGENTS = toList(process.env.GARUPA_USER_AGENTS ?? process.env.GARUPA_USER_AGENT, [
    "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
    "-",
    "-",
    "UnityPlayer/2022.3.62f3c1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
]);
export const GARUPA_CLIENT_PLATFORMS = toList(process.env.GARUPA_CLIENT_PLATFORMS ?? process.env.GARUPA_CLIENT_PLATFORM, ["Android"]);
export const GARUPA_ENCRYPTION_KEYS = toList(process.env.GARUPA_ENCRYPTION_KEYS ?? process.env.GARUPA_ENCRYPTION_KEY, ["-", "-", "-", "-"]);
export const GARUPA_ENCRYPTION_IVS = toList(process.env.GARUPA_ENCRYPTION_IVS ?? process.env.GARUPA_ENCRYPTION_IV, ["-", "-", "-", "-"]);

// CN-specific headers (only required for CN server; other servers can leave "-")
export const GARUPA_RKEYS = toList(process.env.GARUPA_RKEYS, ["-", "-", "-", "-"]);
export const GARUPA_CIDS = toList(process.env.GARUPA_CIDS, ["-", "-", "-", "-"]);
export const GARUPA_PIDS = toList(process.env.GARUPA_PIDS, ["-", "-", "-", "-"]);

export const GARUPA_REFRESH_INTERVAL_SECONDS = toNumber(process.env.GARUPA_REFRESH_INTERVAL_SECONDS, 60);
export const GARUPA_REFRESH_AT_SECOND = toNumber(process.env.GARUPA_REFRESH_AT_SECOND, 0);

// Package lookup URLs per server (used to auto-detect client version)
export const GARUPA_PACKAGE_URLS = toList(process.env.GARUPA_PACKAGE_URLS, [
    "https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band",
    "https://itunes.apple.com/us/lookup?bundleId=com.bushiroad.en.bangdreamgbp",
    "https://itunes.apple.com/tw/lookup?bundleId=net.gamon.bdTW",
    "https://itunes.apple.com/cn/lookup?bundleId=com.bilibili.star",
]);

// Auto-update game client version (triggered on startup and recovery only)
export const GARUPA_VERSION_CHECK_TIMEOUT_MS = toNumber(process.env.MONTHLY_RANKING_VERSION_CHECK_TIMEOUT_MS, 2000);

// Status/unavailability handling
export const GARUPA_STATUS_UNAVAILABILITY_THRESHOLD = toNumber(process.env.MONTHLY_RANKING_STATUS_UNAVAILABILITY_THRESHOLD, 3);
export const GARUPA_STATUS_POLL_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_STATUS_POLL_INTERVAL_MS, 5_000);

export const MONTHLY_RANKING_INFO_POLL_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_INFO_POLL_INTERVAL_MS, 60 * 60 * 1000);
export const MONTHLY_RANKING_REFRESH_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_REFRESH_INTERVAL_MS, GARUPA_REFRESH_INTERVAL_SECONDS * 1000);

export const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
export const MONGODB_DB = process.env.MONGODB_DB ?? "garupa";
export const MONGODB_SERVER_SELECTION_TIMEOUT_MS = toNumber(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 60_000);
export const MONGODB_CONNECT_TIMEOUT_MS = toNumber(process.env.MONGODB_CONNECT_TIMEOUT_MS, 5_000);
export const MONGODB_RECONNECT_INTERVAL_MS = toNumber(process.env.MONGODB_RECONNECT_INTERVAL_MS, 5_000);
export const MONGODB_STARTUP_RETRY_MAX_MS = toNumber(process.env.MONGODB_STARTUP_RETRY_MAX_MS, 300_000);
export const MONGODB_STARTUP_RETRY_INTERVAL_MS = toNumber(process.env.MONGODB_STARTUP_RETRY_INTERVAL_MS, 5_000);
export const MONGODB_GARUPA_META_COLLECTION = process.env.MONGODB_GARUPA_META_COLLECTION ?? "GarupaMeta";
export const MONGODB_MONTHLY_TOP_POINTS_COLLECTION = process.env.MONGODB_MONTHLY_TOP_POINTS_COLLECTION ?? "monthly_top_points";
export const MONGODB_MONTHLY_BORDER_POINTS_COLLECTION = process.env.MONGODB_MONTHLY_BORDER_POINTS_COLLECTION ?? "monthly_border_points";
export const MONGODB_RANKING_PLAYERS_COLLECTION = process.env.MONGODB_RANKING_PLAYERS_COLLECTION ?? "ranking_players";
export const MONGODB_MONTHLY_INFO_COLLECTION = process.env.MONGODB_MONTHLY_INFO_COLLECTION ?? "monthly_ranking_info";

// Event ranking
export const MONGODB_EVENT_TOP_POINTS_COLLECTION = process.env.MONGODB_EVENT_TOP_POINTS_COLLECTION ?? "event_top_points";
export const MONGODB_EVENT_BORDER_POINTS_COLLECTION = process.env.MONGODB_EVENT_BORDER_POINTS_COLLECTION ?? "event_border_points";
export const MONGODB_MUSIC_TOP_POINTS_COLLECTION = process.env.MONGODB_MUSIC_TOP_POINTS_COLLECTION ?? "music_top_points";
export const MONGODB_MUSIC_BORDER_POINTS_COLLECTION = process.env.MONGODB_MUSIC_BORDER_POINTS_COLLECTION ?? "music_border_points";
export const MONGODB_EVENT_INFO_COLLECTION = process.env.MONGODB_EVENT_INFO_COLLECTION ?? "event_info";
export const EVENT_RANKING_INFO_POLL_INTERVAL_MS = toNumber(process.env.EVENT_RANKING_INFO_POLL_INTERVAL_MS, 60 * 60 * 1000);
export const EVENT_RANKING_REFRESH_INTERVAL_MS = toNumber(process.env.EVENT_RANKING_REFRESH_INTERVAL_MS, GARUPA_REFRESH_INTERVAL_SECONDS * 1000);
