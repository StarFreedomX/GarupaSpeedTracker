import dotenv from "dotenv";

// Prefer local overrides first, then fallback to shared env defaults.
dotenv.config({ path: [".env.local", ".env", ".env.example"] });

/**
 * Parses a numeric environment variable with a fallback.
 *
 * Returns `fallback` when the value is `undefined`, empty, or not a finite number.
 */
const toNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Parses a boolean environment variable with a fallback.
 *
 * Returns `true` for strings "true" or "1" (case-insensitive). Any other
 * defined, non-empty value returns `false`.
 */
const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
};

/**
 * Parses a comma-separated string into a list, falling back to a default array.
 *
 * Empty or whitespace-only entries are filtered out. Returns `fallback` when
 * the input is empty or contains no valid entries.
 */
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

/** Bestdori API base URL. */
export const BESTDORI_API = process.env.BESTDORI_API ?? "https://bestdori.com/api/";

/** HTTP server host. */
export const HOST = process.env.HOST ?? "127.0.0.1";
/** HTTP server port. */
export const PORT = toNumber(process.env.PORT, 5519);
/** Prefix prepended to all API routes. */
export const API_PREFIX = process.env.API_PREFIX ?? "/api";

/** Seconds: if the newest Bestdori point is newer than this threshold, reuse cache. */
export const MIN_POINTS_UPDATE_TIME = toNumber(process.env.MIN_POINTS_UPDATE_TIME, 45);

/** Seconds: cache duration for static info (cards, skills, events, etc.). */
export const INFO_CACHE_TIME = toNumber(process.env.INFO_CACHE_TIME, 12 * 3600);

/** Connection failure timeout in ms. */
export const DOWNLOADER_TIMEOUT_MS = toNumber(process.env.DOWNLOADER_TIMEOUT_MS, 10_000);

// --- Two-level cache limits ---

/** Maximum entries in the in-memory LRU cache. */
export const MEMORY_CACHE_MAX_ENTRIES = toNumber(process.env.MEMORY_CACHE_MAX_ENTRIES, 24);
/** Maximum bytes in the in-memory LRU cache (default 256 MB). */
export const MEMORY_CACHE_MAX_BYTES = toNumber(process.env.MEMORY_CACHE_MAX_BYTES, 256 * 1024 * 1024);
/** Maximum bytes for disk cache (default 1 GB). */
export const DISK_CACHE_MAX_BYTES = toNumber(process.env.DISK_CACHE_MAX_BYTES, 1024 * 1024 * 1024);
/** Interval in ms for disk cache cleanup. */
export const DISK_CACHE_CLEANUP_INTERVAL_MS = toNumber(process.env.DISK_CACHE_CLEANUP_INTERVAL_MS, 5 * 60 * 1000);

/** Interval in ms between Bestdori songs metadata checks (default 24h). */
export const BESTDORI_SONGS_CHECK_INTERVAL_MS = toNumber(process.env.BESTDORI_SONGS_CHECK_INTERVAL_MS, 24 * 60 * 60 * 1000);
/** When true, stores raw chart data from Bestdori in the database. */
export const BESTDORI_STORE_RAW_CHARTS = toBoolean(process.env.BESTDORI_STORE_RAW_CHARTS, false);

/** Default polling interval in ms. */
export const DEFAULT_INTERVAL = 30_000;

/** When true, enables CORS headers on all responses. */
export const ENABLE_CORS = toBoolean(process.env.ENABLE_CORS, false);
/** When true, trusts X-Forwarded-* proxy headers. */
export const APP_PROXY = toBoolean(process.env.APP_PROXY, false);

// --- Garupa (game client) server config per region ---

/** Per-server game API base URLs (4 servers). */
export const GARUPA_SERVER_BASES = toList(process.env.GARUPA_SERVER_BASES, ["-", "-", "-", "-"]);
/** Per-server game user IDs. */
export const GARUPA_UIDS = toList(process.env.GARUPA_UIDS, ["-", "-", "-", "-"]);
/** Per-server game UUIDs. */
export const GARUPA_UUIDS = toList(process.env.GARUPA_UUIDS, ["-", "-", "-", "-"]);
/** Per-server client version strings. */
export const GARUPA_CLIENT_VERSIONS = toList(process.env.GARUPA_CLIENT_VERSIONS ?? process.env.GARUPA_CLIENT_VERSION, ["10.1.3", "-", "-", "-"]);
/** Per-server Unity engine versions. */
export const GARUPA_UNITY_VERSIONS = toList(process.env.GARUPA_UNITY_VERSIONS ?? process.env.GARUPA_UNITY_VERSION, ["2021.3.45f2", "-", "-", "2022.3.62f3c1"]);
/** Per-server User-Agent headers. */
export const GARUPA_USER_AGENTS = toList(process.env.GARUPA_USER_AGENTS ?? process.env.GARUPA_USER_AGENT, [
    "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
    "-",
    "-",
    "UnityPlayer/2022.3.62f3c1 (UnityWebRequest/1.0, libcurl/8.10.1-DEV)",
]);
/** Per-server client platform identifiers. */
export const GARUPA_CLIENT_PLATFORMS = toList(process.env.GARUPA_CLIENT_PLATFORMS ?? process.env.GARUPA_CLIENT_PLATFORM, ["Android"]);
/** Per-server encryption keys. */
export const GARUPA_ENCRYPTION_KEYS = toList(process.env.GARUPA_ENCRYPTION_KEYS ?? process.env.GARUPA_ENCRYPTION_KEY, ["-", "-", "-", "-"]);
/** Per-server encryption IVs. */
export const GARUPA_ENCRYPTION_IVS = toList(process.env.GARUPA_ENCRYPTION_IVS ?? process.env.GARUPA_ENCRYPTION_IV, ["-", "-", "-", "-"]);

// --- CN-specific headers (only required for CN server; other servers can leave "-") ---

/** Per-server rkeys (CN-specific). */
export const GARUPA_RKEYS = toList(process.env.GARUPA_RKEYS, ["-", "-", "-", "-"]);
/** Per-server cids (CN-specific). */
export const GARUPA_CIDS = toList(process.env.GARUPA_CIDS, ["-", "-", "-", "-"]);
/** Per-server pids (CN-specific). */
export const GARUPA_PIDS = toList(process.env.GARUPA_PIDS, ["-", "-", "-", "-"]);

/** Interval in seconds between Garupa data refreshes. */
export const GARUPA_REFRESH_INTERVAL_SECONDS = toNumber(process.env.GARUPA_REFRESH_INTERVAL_SECONDS, 60);
/** Second-of-minute offset for timed refreshes. */
export const GARUPA_REFRESH_AT_SECOND = toNumber(process.env.GARUPA_REFRESH_AT_SECOND, 0);

// --- Package lookup URLs per server (used to auto-detect client version) ---

/** Per-server App Store lookup URLs for version detection. */
export const GARUPA_PACKAGE_URLS = toList(process.env.GARUPA_PACKAGE_URLS, [
    "https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band",
    "https://itunes.apple.com/us/lookup?bundleId=com.bushiroad.en.bangdreamgbp",
    "https://itunes.apple.com/tw/lookup?bundleId=net.gamon.bdTW",
    "https://itunes.apple.com/cn/lookup?bundleId=com.bilibili.star",
]);

/** Timeout in ms for game client version checks (triggered on startup and recovery). */
export const GARUPA_VERSION_CHECK_TIMEOUT_MS = toNumber(process.env.MONTHLY_RANKING_VERSION_CHECK_TIMEOUT_MS, 2000);

// --- Status/unavailability handling ---

/** Number of consecutive failures before marking a server unavailable. */
export const GARUPA_STATUS_UNAVAILABILITY_THRESHOLD = toNumber(process.env.MONTHLY_RANKING_STATUS_UNAVAILABILITY_THRESHOLD, 3);
/** Poll interval in ms when a server is marked unavailable. */
export const GARUPA_STATUS_POLL_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_STATUS_POLL_INTERVAL_MS, 5_000);

/** Interval in ms between monthly ranking info metadata polls (default 1h). */
export const MONTHLY_RANKING_INFO_POLL_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_INFO_POLL_INTERVAL_MS, 60 * 60 * 1000);
/** Interval in ms between monthly ranking data refreshes. */
export const MONTHLY_RANKING_REFRESH_INTERVAL_MS = toNumber(process.env.MONTHLY_RANKING_REFRESH_INTERVAL_MS, GARUPA_REFRESH_INTERVAL_SECONDS * 1000);

// --- MongoDB configuration ---

/** MongoDB connection URI. */
export const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
/** MongoDB database name. */
export const MONGODB_DB = process.env.MONGODB_DB ?? "garupa";
/** MongoDB server selection timeout in ms. */
export const MONGODB_SERVER_SELECTION_TIMEOUT_MS = toNumber(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 60_000);
/** MongoDB connection probe timeout in ms. */
export const MONGODB_CONNECT_TIMEOUT_MS = toNumber(process.env.MONGODB_CONNECT_TIMEOUT_MS, 5_000);
/** MongoDB heartbeat/reconnect interval in ms. */
export const MONGODB_RECONNECT_INTERVAL_MS = toNumber(process.env.MONGODB_RECONNECT_INTERVAL_MS, 5_000);
/** Maximum time in ms to retry MongoDB connection at startup. */
export const MONGODB_STARTUP_RETRY_MAX_MS = toNumber(process.env.MONGODB_STARTUP_RETRY_MAX_MS, 300_000);
/** Interval between MongoDB startup retry attempts. */
export const MONGODB_STARTUP_RETRY_INTERVAL_MS = toNumber(process.env.MONGODB_STARTUP_RETRY_INTERVAL_MS, 5_000);
/** Collection name for Garupa metadata. */
export const MONGODB_GARUPA_META_COLLECTION = process.env.MONGODB_GARUPA_META_COLLECTION ?? "GarupaMeta";
/** Collection name for monthly top points. */
export const MONGODB_MONTHLY_TOP_POINTS_COLLECTION = process.env.MONGODB_MONTHLY_TOP_POINTS_COLLECTION ?? "monthly_top_points";
/** Collection name for monthly border points. */
export const MONGODB_MONTHLY_BORDER_POINTS_COLLECTION = process.env.MONGODB_MONTHLY_BORDER_POINTS_COLLECTION ?? "monthly_border_points";
/** Collection name for ranking player data. */
export const MONGODB_RANKING_PLAYERS_COLLECTION = process.env.MONGODB_RANKING_PLAYERS_COLLECTION ?? "ranking_players";
/** Collection name for monthly ranking info. */
export const MONGODB_MONTHLY_INFO_COLLECTION = process.env.MONGODB_MONTHLY_INFO_COLLECTION ?? "monthly_ranking_info";

// --- Event ranking ---

/** Collection name for event top points. */
export const MONGODB_EVENT_TOP_POINTS_COLLECTION = process.env.MONGODB_EVENT_TOP_POINTS_COLLECTION ?? "event_top_points";
/** Collection name for event border points. */
export const MONGODB_EVENT_BORDER_POINTS_COLLECTION = process.env.MONGODB_EVENT_BORDER_POINTS_COLLECTION ?? "event_border_points";
/** Collection name for music top points. */
export const MONGODB_MUSIC_TOP_POINTS_COLLECTION = process.env.MONGODB_MUSIC_TOP_POINTS_COLLECTION ?? "music_top_points";
/** Collection name for music border points. */
export const MONGODB_MUSIC_BORDER_POINTS_COLLECTION = process.env.MONGODB_MUSIC_BORDER_POINTS_COLLECTION ?? "music_border_points";
/** Collection name for event info. */
export const MONGODB_EVENT_INFO_COLLECTION = process.env.MONGODB_EVENT_INFO_COLLECTION ?? "event_info";
/** Interval in ms between event ranking info metadata polls. */
export const EVENT_RANKING_INFO_POLL_INTERVAL_MS = toNumber(process.env.EVENT_RANKING_INFO_POLL_INTERVAL_MS, 60 * 60 * 1000);
/** Interval in ms between event ranking data refreshes. */
export const EVENT_RANKING_REFRESH_INTERVAL_MS = toNumber(process.env.EVENT_RANKING_REFRESH_INTERVAL_MS, GARUPA_REFRESH_INTERVAL_SECONDS * 1000);

// --- Post-end polling ---

/** Polling interval in ms for event ranking after the event ends. */
export const EVENT_POST_END_POLL_INTERVAL_MS = toNumber(process.env.EVENT_POST_END_POLL_INTERVAL_MS, 3_600_000);
/** Max duration in ms to continue polling event ranking after the event ends. */
export const EVENT_POST_END_MAX_DURATION_MS = toNumber(process.env.EVENT_POST_END_MAX_DURATION_MS, 86_400_000);
/** Polling interval in ms for monthly ranking after the month ends. */
export const MONTHLY_POST_END_POLL_INTERVAL_MS = toNumber(process.env.MONTHLY_POST_END_POLL_INTERVAL_MS, 3_600_000);
/** Max duration in ms to continue polling monthly ranking after the month ends. */
export const MONTHLY_POST_END_MAX_DURATION_MS = toNumber(process.env.MONTHLY_POST_END_MAX_DURATION_MS, 43_200_000);
