import * as crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
    GARUPA_CIDS,
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_CLIENT_VERSIONS,
    GARUPA_CN_ACCOUNT,
    GARUPA_CN_AD_ID,
    GARUPA_CN_APK_SIGN,
    GARUPA_CN_BD_ID,
    GARUPA_CN_BUVID,
    GARUPA_CN_DEVICE_ID,
    GARUPA_CN_DEVICE_MODEL,
    GARUPA_CN_DEVICE_OS,
    GARUPA_CN_LOGIN_RETRY_MS,
    GARUPA_CN_PASSWORD,
    GARUPA_CN_SDK_APP_KEY,
    GARUPA_CN_SDK_BASE,
    GARUPA_CN_SDK_UDID,
    GARUPA_CN_SDK_VERSION,
    GARUPA_CN_LOGIN_TIMEOUT_MS,
    GARUPA_CN_VERSION_CODE,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_PACKAGE_URLS,
    GARUPA_PIDS,
    GARUPA_RKEYS,
    GARUPA_SERVER_BASES,
    GARUPA_STATUS_POLL_INTERVAL_MS,
    GARUPA_STATUS_UNAVAILABILITY_THRESHOLD,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
    GARUPA_VERSION_CHECK_TIMEOUT_MS,
} from "@/config";
import { logger } from "@/logger";
import { bandoriEventRankingParser } from "@/parsers/GarupaEventRankingParser";
import { bandoriMonthlyRankingParser as garupaMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { validateEventRanking, validateMonthlyRanking } from "@/parsers/GarupaResponseValidator";
import { downloader } from "@/storage/downloader";
import type { EventRankingBandoriRaw } from "@/types/event";
import type { MonthlyRankingBandoriRaw } from "@/types/monthlyRanking";
import { type CnConfig, CnSessionClient, cnHeaders } from "./cnSession";

/**
 * Converts a raw server base URL into the canonical Garupa API base URL.
 * Accepts full URLs, bare hostnames, or a "-" placeholder (returns empty string).
 * @param raw - Raw input URL or hostname
 */
const toBaseUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-") {
        return "";
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    }

    return `https://${trimmed.replace(/\/+$/, "")}/api/`;
};

/**
 * Resolves a configuration value for a given server index (with fallback to index 0).
 * Throws if the resolved value is empty or a placeholder ("-").
 * @param values - Configuration string array
 * @param server - Server index
 * @param label - Human-readable label used in error messages
 */
const resolveServerValue = (values: string[], server: number, label: string): string => {
    const raw = values[server] ?? values[0] ?? "";
    const normalized = raw.trim();
    if (!normalized || normalized === "-") {
        throw new Error(`${label} not configured for server ${server}`);
    }

    return normalized;
};

/**
 * Resolves an optional configuration value for a given server index.
 * Returns `undefined` when the value is empty or a placeholder ("-").
 * @param values - Configuration string array
 * @param server - Server index
 */
const resolveOptionalServerValue = (values: string[], server: number): string | undefined => {
    const raw = values[server] ?? values[0] ?? "";
    const normalized = raw.trim();
    if (!normalized || normalized === "-") {
        return undefined;
    }
    return normalized;
};

/**
 * Returns the base API URL for a given server index.
 * Resolves the server base from config and normalizes it via {@link toBaseUrl}.
 * @param server - Server index
 * @throws If the configured base URL is empty or missing
 */
const getGarupaBaseUrl = (server: number): string => {
    const baseRaw = resolveServerValue(GARUPA_SERVER_BASES, server, "GARUPA_SERVER_BASES");
    const base = toBaseUrl(baseRaw);
    if (!base) {
        throw new Error(`Monthly ranking base URL is missing for server ${server}`);
    }

    return base;
};

/** Returns the player UID string for the given server index. */
const getGarupaUid = (server: number): string => resolveServerValue(GARUPA_UIDS, server, "GARUPA_UIDS");
/** Returns the device UUID string for the given server index. */
const getGarupaUuid = (server: number): string => resolveServerValue(GARUPA_UUIDS, server, "GARUPA_UUIDS");
/** Returns the Unity version string for the given server index. */
const getGarupaUnityVersion = (server: number): string => resolveServerValue(GARUPA_UNITY_VERSIONS, server, "GARUPA_UNITY_VERSIONS");
/** Returns the User-Agent string for the given server index. */
const getGarupaUserAgent = (server: number): string => resolveServerValue(GARUPA_USER_AGENTS, server, "GARUPA_USER_AGENTS");
/** Returns the client platform identifier for the given server index. */
const getGarupaClientPlatform = (server: number): string => resolveServerValue(GARUPA_CLIENT_PLATFORMS, server, "GARUPA_CLIENT_PLATFORMS");
/** Returns the AES-128-CBC encryption key for the given server index. */
const getGarupaEncryptionKey = (server: number): string => resolveServerValue(GARUPA_ENCRYPTION_KEYS, server, "GARUPA_ENCRYPTION_KEYS");
/** Returns the AES-128-CBC IV for the given server index. */
const getGarupaEncryptionIv = (server: number): string => resolveServerValue(GARUPA_ENCRYPTION_IVS, server, "GARUPA_ENCRYPTION_IVS");
/** Returns the optional channel ID for the given server index, or `undefined` if not configured. */
const getGarupaChannelId = (server: number): string | undefined => resolveOptionalServerValue(GARUPA_CIDS, server);
/** Returns the optional platform ID for the given server index, or `undefined` if not configured. */
const getGarupaPlatformId = (server: number): string | undefined => resolveOptionalServerValue(GARUPA_PIDS, server);
/**
 * Returns the optional fallback client version for the given server index.
 * This value is used when the client version cannot be queried from the live API.
 */
export const getGarupaFallbackClientVersion = (server: number): string | undefined => resolveOptionalServerValue(GARUPA_CLIENT_VERSIONS, server);
/**
 * Returns the APK/OBB package download URL for the given server index.
 * Used for scraping the latest client version from the store page.
 */
export const getGarupaPackageUrl = (server: number): string => resolveServerValue(GARUPA_PACKAGE_URLS, server, "GARUPA_PACKAGE_URLS");
/** Returns the total number of configured Garupa servers. */
export const getGarupaServerCount = (): number => GARUPA_SERVER_BASES.length;
/** Returns the polling interval (in milliseconds) for Garupa server status checks. */
export const getGarupaStatusPollIntervalMs = (): number => GARUPA_STATUS_POLL_INTERVAL_MS;
/** Returns the consecutive failure threshold after which a Garupa server is considered unavailable. */
export const getGarupaStatusUnavailabilityThreshold = (): number => GARUPA_STATUS_UNAVAILABILITY_THRESHOLD;
/** Returns the HTTP request timeout (in milliseconds) for Garupa version checks. */
export const getGarupaVersionCheckTimeoutMs = (): number => GARUPA_VERSION_CHECK_TIMEOUT_MS;

/**
 * Builds the full URL for a monthly ranking request.
 * @param server - Server index
 * @param monthlyId - Monthly ranking period ID
 * @param userId - Authenticated game UID; falls back to configuration when omitted
 */
const buildMonthlyRankingUrl = (server: number, monthlyId: number, userId?: string): string => {
    const base = getGarupaBaseUrl(server);
    const uid = userId ?? getGarupaUid(server);
    const url = new URL(`user/${uid}/monthlyranking/${monthlyId}/ranking`, base);
    return url.toString();
};

/**
 * Builds the full URL for the monthly ranking master list request.
 * @param server - Server index
 */
const buildMonthlyRankingMasterListUrl = (server: number): string => {
    const base = getGarupaBaseUrl(server);
    const url = new URL("monthlyranking", base);
    return url.toString();
};

/**
 * Converts a string value to a 16-byte Buffer suitable for AES-128-CBC.
 * Throws if the resulting buffer is not exactly 16 bytes.
 * @param value - Raw string value
 * @param label - Human-readable label for error messages
 */
const toCipherBuffer = (value: string, label: string): Buffer => {
    const buffer = Buffer.from(value);
    if (buffer.length !== 16) {
        throw new Error(`${label} must be 16 bytes, got ${buffer.length}`);
    }
    return buffer;
};

/**
 * Returns the list of enabled Garupa server indices (where the base URL is non-empty and not "-").
 */
export const getGarupaServerIds = (): number[] =>
    GARUPA_SERVER_BASES.map((value, index) => ({ value: value.trim(), index }))
        .filter((entry) => entry.value && entry.value !== "-")
        .map((entry) => entry.index);

/** 组装国服登录配置，并读取各服共用配置的第四项。 / Resolves CN login settings and the fourth entries of the shared per-server configuration. */
const cnConfig = (): CnConfig => {
    return {
        encryptionKey: getCipherKey(3),
        encryptionIv: getCipherIv(3),
        requestKey: resolveServerValue(GARUPA_RKEYS, 3, "GARUPA_RKEYS"),
        sdkAppKey: GARUPA_CN_SDK_APP_KEY,
        account: GARUPA_CN_ACCOUNT,
        password: GARUPA_CN_PASSWORD,
        sdkBase: GARUPA_CN_SDK_BASE,
        deviceId: GARUPA_CN_DEVICE_ID,
        buvid: GARUPA_CN_BUVID,
        sdkUdid: GARUPA_CN_SDK_UDID,
        bdId: GARUPA_CN_BD_ID,
        deviceModel: GARUPA_CN_DEVICE_MODEL,
        deviceOs: GARUPA_CN_DEVICE_OS,
        adId: GARUPA_CN_AD_ID,
        apkSign: GARUPA_CN_APK_SIGN,
        sdkVersion: GARUPA_CN_SDK_VERSION,
        channelId: resolveServerValue(GARUPA_CIDS, 3, "GARUPA_CIDS"),
        platformId: resolveServerValue(GARUPA_PIDS, 3, "GARUPA_PIDS"),
        clientPlatform: getGarupaClientPlatform(3),
        userAgent: getGarupaUserAgent(3),
        versionCode: GARUPA_CN_VERSION_CODE,
        unityVersion: getGarupaUnityVersion(3),
        loginTimeoutMs: GARUPA_CN_LOGIN_TIMEOUT_MS,
        retryDelayMs: GARUPA_CN_LOGIN_RETRY_MS,
    };
};
/** 按需创建并由国服月榜和活动榜共用的会话。 / Lazily created session shared by CN monthly and event ranking requests. */
let cnClient: CnSessionClient | undefined;
/**
 * Builds the HTTP request headers required by the Garupa API for a given server.
 * Includes User-Agent, Unity version, client platform/version, and optional channel/platform IDs.
 * @param server - Server index
 * @param clientVersion - Client version string (from live version check or fallback)
 */
export const createGarupaHeaders = (server: number, clientVersion: string, anonymous = false) => {
    if (server === 3) return cnHeaders(cnConfig(), clientVersion);
    const channelId = getGarupaChannelId(server);
    const platformId = getGarupaPlatformId(server);

    const headers: Record<string, string> = {
        "User-Agent": getGarupaUserAgent(server),
        "X-Unity-Version": getGarupaUnityVersion(server),
        "X-ClientPlatform": getGarupaClientPlatform(server),
        "X-ClientVersion": clientVersion,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };

    if (!anonymous) headers["X-Signature"] = getGarupaUuid(server);

    if (channelId) headers["X-ChannelID"] = channelId;
    if (platformId) headers["X-PlatformID"] = platformId;

    return headers;
};

const cipherKeyCache = new Map<number, Buffer>();
const cipherIvCache = new Map<number, Buffer>();

/**
 * Returns the AES-128-CBC encryption key Buffer for the given server (cached).
 * @param server - Server index
 */
const getCipherKey = (server: number): Buffer => {
    const cached = cipherKeyCache.get(server);
    if (cached) {
        return cached;
    }
    const key = toCipherBuffer(getGarupaEncryptionKey(server), "GARUPA_ENCRYPTION_KEYS");
    cipherKeyCache.set(server, key);
    return key;
};

/**
 * Returns the AES-128-CBC IV Buffer for the given server (cached).
 * @param server - Server index
 */
const getCipherIv = (server: number): Buffer => {
    const cached = cipherIvCache.get(server);
    if (cached) {
        return cached;
    }
    const iv = toCipherBuffer(getGarupaEncryptionIv(server), "GARUPA_ENCRYPTION_IVS");
    cipherIvCache.set(server, iv);
    return iv;
};

/**
 * Decrypts a Garupa API response payload using AES-128-CBC with NoPadding.
 * The key and IV are resolved from per-server configuration.
 * @param server - Server index
 * @param payload - Encrypted response body
 */
const decryptPayload = (server: number, payload: Buffer): Buffer => {
    const decipher = crypto.createDecipheriv("aes-128-cbc", getCipherKey(server), getCipherIv(server));
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(payload), decipher.final()]);
};

/** JP song masters are public: no player UID or UUID is needed. */
export const fetchJpSuiteMasterBuffer = async (clientVersion: string): Promise<Buffer> => {
    const configuredBase = GARUPA_SERVER_BASES[0]?.trim();
    const base = configuredBase && configuredBase !== "-" ? getGarupaBaseUrl(0) : "https://api.garupa.jp/api/";
    const { status, body } = await downloader.downloadRaw(new URL("suite/master", base).toString(), createGarupaHeaders(0, clientVersion, true));
    if (status < 200 || status >= 300) throw new Error(`JP suite master HTTP ${status}`);
    return decryptPayload(0, body);
};

/**
 * 按区服选择认证流程并获取、解密榜单。国服由会话层管理登录和 Token/nonce，所有榜单请求使用统一下载器。
 * Fetches and decrypts ranking data using the appropriate server authentication path.
 * CN delegates login and token/nonce updates to the shared session; all ranking HTTP requests
 * use the common downloader. Other regions use their configured UID and request headers.
 * @param urlForUser - Builds the ranking URL, accepting the authenticated game UID for CN
 * @param server - Server index
 * @param clientVersion - Game client version string
 * @returns Decrypted response, HTTP status, and encrypted response size in bytes
 */
const fetchRankingBuffer = async (
    urlForUser: (uid?: string) => string,
    server: number,
    clientVersion: string,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    if (server === 3) {
        cnClient ??= new CnSessionClient(cnConfig());
        return cnClient.fetch(getGarupaBaseUrl(server), clientVersion, urlForUser);
    }
    const url = urlForUser();
    const { status, body } = await downloader.downloadRaw(url, createGarupaHeaders(server, clientVersion));
    logger("garupaApi", `fetch ${url} → status=${status} len=${body.length}`);
    return { decrypted: decryptPayload(server, body), status, length: body.length };
};

/**
 * Fetches a monthly ranking response as a raw decrypted Buffer and HTTP status.
 * Delegates to {@link fetchRankingBuffer} which handles the serialized CN login session.
 * @param server - Server index
 * @param monthlyId - Monthly ranking period ID
 * @param clientVersion - Client version string
 */
export const fetchMonthlyRankingBuffer = async (
    server: number,
    monthlyId: number,
    clientVersion: string,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    return fetchRankingBuffer((uid) => buildMonthlyRankingUrl(server, monthlyId, uid), server, clientVersion);
};

/**
 * Fetches and parses a monthly ranking. Returns the parsed {@link MonthlyRankingBandoriRaw} data.
 * On parse failure, the raw decrypted buffer is saved to `cache/diag/` for debugging.
 * @throws If the HTTP status is non-2xx or protobuf parsing fails
 */
export const fetchMonthlyRanking = async (server: number, monthlyId: number, clientVersion: string): Promise<MonthlyRankingBandoriRaw> => {
    const { decrypted, status } = await fetchMonthlyRankingBuffer(server, monthlyId, clientVersion);
    if (status < 200 || status >= 300) {
        throw new Error(`Monthly ranking HTTP ${status}`);
    }

    try {
        const report = garupaMonthlyRankingParser.parse(decrypted);

        const validation = validateMonthlyRanking(report, server);
        if (!validation.valid) {
            logger("garupaApi", `monthlyId=${monthlyId} validation failed: ${validation.reason}, retrying once`);
            const { decrypted: dec2, status: st2 } = await fetchMonthlyRankingBuffer(server, monthlyId, clientVersion);
            if (st2 < 200 || st2 >= 300) {
                throw new Error(`Monthly ranking HTTP ${st2}`);
            }
            const report2 = garupaMonthlyRankingParser.parse(dec2);
            const validation2 = validateMonthlyRanking(report2, server);
            if (!validation2.valid) {
                throw new Error(`Monthly ranking validation still failing after retry: ${validation2.reason}`);
            }
            return report2;
        }

        return report;
    } catch (parseErr) {
        const diagDir = path.join("cache", "diag");
        await fs.mkdir(diagDir, { recursive: true });
        const ts = Date.now();
        const binFile = path.join(diagDir, `monthly-parse-err-${server}-${monthlyId}-${ts}.bin`);
        await fs.writeFile(binFile, decrypted);
        logger("garupaApi", `parse error buffer saved: ${binFile} (${decrypted.length}B) error=${(parseErr as Error)?.message}`);
        throw parseErr;
    }
};

/**
 * Fetches the monthly ranking master list (available periods) as a raw decrypted Buffer and HTTP status.
 * Unlike {@link fetchMonthlyRankingBuffer}, this does **not** use the CN RID signing path.
 * @param server - Server index
 * @param clientVersion - Client version string
 */
export const fetchMonthlyRankingMasterListBuffer = async (
    server: number,
    clientVersion: string,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    const url = buildMonthlyRankingMasterListUrl(server);
    const headers = createGarupaHeaders(server, clientVersion);

    const { status, body: bodyBuffer } = await downloader.downloadRaw(url, headers);
    const decrypted = decryptPayload(server, bodyBuffer);
    return { decrypted, status, length: bodyBuffer.length };
};

/**
 * Checks whether the Garupa game API is reachable for a given server by hitting its `/application` endpoint.
 * @param server - Server index
 * @param clientVersion - Client version string
 * @param timeoutMs - HTTP request timeout in milliseconds (default 2000)
 * @returns `true` if the endpoint returns a 2xx response, `false` otherwise
 */
export const checkGarupaGameStatus = async (server: number, clientVersion: string, timeoutMs: number = 2000): Promise<boolean> => {
    const base = getGarupaBaseUrl(server);
    const url = new URL("application", base).toString();
    const headers = createGarupaHeaders(server, clientVersion);
    try {
        const { status } = await downloader.downloadRaw(url, headers, timeoutMs);
        return status >= 200 && status < 300;
    } catch (_e) {
        return false;
    }
};

/**
 * Polls the Garupa game API until the server becomes available (responds with HTTP 2xx).
 * Uses an infinite loop with configurable polling interval and timeout.
 * @param server - Server index
 * @param clientVersion - Client version string
 * @param pollIntervalMs - Delay between status checks in milliseconds (default 5000)
 * @param timeoutMs - Per-request HTTP timeout in milliseconds (default 2000)
 */
export const waitUntilGarupaAvailable = async (
    server: number,
    clientVersion: string,
    pollIntervalMs: number = 5000,
    timeoutMs: number = 2000,
): Promise<void> => {
    while (true) {
        try {
            const ok = await checkGarupaGameStatus(server, clientVersion, timeoutMs);
            if (ok) {
                return;
            }
        } catch {
            // ignore and continue polling
        }

        await new Promise((resolve) => setTimeout(resolve, Math.max(1000, pollIntervalMs)));
    }
};

// ============================================================================
// Event Ranking
// ============================================================================

/**
 * Maps protobuf event type strings to their corresponding API URL path segments.
 * Derived from decompiled client URL templates; consistent across JP and CN servers.
 */
const EVENT_TYPE_TO_URL_SEGMENT: Readonly<Record<string, string>> = {
    challenge: "challenge",
    live_try: "livetry",
    medley: "medley",
    mission_live: "mission",
    story: "story",
    team_live_festival: "festival",
    versus: "versus",
};

const eventTypeToUrlSegment = (protobufEventType: string): string => EVENT_TYPE_TO_URL_SEGMENT[protobufEventType] ?? protobufEventType;

/**
 * Builds the full URL for an event ranking request.
 * @param server - Server index
 * @param eventId - Event ID
 * @param eventType - Protobuf event type string (e.g. "medley", "challenge", "versus")
 * @param mid - Optional music ID for sub-rankings within the event
 * @param userId - Authenticated game UID; falls back to configuration when omitted
 */
export const buildEventRankingUrl = (server: number, eventId: number, eventType: string, mid?: number, userId?: string): string => {
    const base = getGarupaBaseUrl(server);
    const uid = userId ?? getGarupaUid(server);
    const urlSegment = eventTypeToUrlSegment(eventType);
    const url = new URL(`user/${uid}/event/${eventId}/${urlSegment}/ranking`, base);
    if (mid !== undefined) {
        url.searchParams.set("mid", String(mid));
    }
    return url.toString();
};

/**
 * Builds the full URL for the event master list request (list of all events on a server).
 * @param server - Server index
 */
export const buildEventMasterListUrl = (server: number): string => {
    const base = getGarupaBaseUrl(server);
    const url = new URL("event", base);
    return url.toString();
};

/**
 * Fetches an event ranking response as a raw decrypted Buffer and HTTP status.
 * Delegates to {@link fetchRankingBuffer} which handles the serialized CN login session.
 * @param server - Server index
 * @param eventId - Event ID
 * @param eventType - Protobuf event type string
 * @param clientVersion - Client version string
 * @param mid - Optional music ID for sub-rankings
 */
export const fetchEventRankingBuffer = async (
    server: number,
    eventId: number,
    eventType: string,
    clientVersion: string,
    mid?: number,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    return fetchRankingBuffer((uid) => buildEventRankingUrl(server, eventId, eventType, mid, uid), server, clientVersion);
};

/**
 * Fetches the event master list (available events) as a raw decrypted Buffer and HTTP status.
 * Unlike {@link fetchEventRankingBuffer}, this does **not** use the CN RID signing path.
 * @param server - Server index
 * @param clientVersion - Client version string
 */
export const fetchEventMasterListBuffer = async (server: number, clientVersion: string): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    const url = buildEventMasterListUrl(server);
    const headers = createGarupaHeaders(server, clientVersion);

    const { status, body: bodyBuffer } = await downloader.downloadRaw(url, headers);
    const decrypted = decryptPayload(server, bodyBuffer);
    return { decrypted, status, length: bodyBuffer.length };
};

/**
 * Fetches and parses an event ranking. Returns the parsed {@link EventRankingBandoriRaw} data.
 * Selects the correct protobuf schema and report builder based on `eventType`.
 * On parse failure, the raw decrypted buffer is saved to `cache/diag/` for debugging.
 * @param server - Server index
 * @param eventId - Event ID
 * @param eventType - Protobuf event type string (e.g. "medley", "challenge", "versus", "story", "mission_live", "live_try", "team_live_festival")
 * @param clientVersion - Client version string
 * @param mid - Optional music ID for sub-rankings within the event
 * @throws If the HTTP status is non-2xx, the event type is unsupported, or protobuf parsing fails
 */
export const fetchEventRanking = async (
    server: number,
    eventId: number,
    eventType: string,
    clientVersion: string,
    mid?: number,
): Promise<EventRankingBandoriRaw> => {
    const { decrypted, status } = await fetchEventRankingBuffer(server, eventId, eventType, clientVersion, mid);
    if (status < 200 || status >= 300) {
        throw new Error(`Event ranking HTTP ${status}`);
    }

    try {
        const report = bandoriEventRankingParser.parse(decrypted, eventType);

        const validation = validateEventRanking(report, server);
        if (!validation.valid) {
            logger("garupaApi", `eventId=${eventId} validation failed: ${validation.reason}, retrying once`);
            const { decrypted: dec2, status: st2 } = await fetchEventRankingBuffer(server, eventId, eventType, clientVersion, mid);
            if (st2 < 200 || st2 >= 300) {
                throw new Error(`Event ranking HTTP ${st2}`);
            }
            const report2 = bandoriEventRankingParser.parse(dec2, eventType);
            const validation2 = validateEventRanking(report2, server);
            if (!validation2.valid) {
                throw new Error(`Event ranking validation still failing after retry: ${validation2.reason}`);
            }
            return report2;
        }

        return report;
    } catch (parseErr) {
        // Save the exact buffer that caused parse failure
        const diagDir = path.join("cache", "diag");
        await fs.mkdir(diagDir, { recursive: true });
        const ts = Date.now();
        const binFile = path.join(diagDir, `event-parse-err-${server}-${eventId}-${ts}.bin`);
        await fs.writeFile(binFile, decrypted);
        logger("garupaApi", `parse error buffer saved: ${binFile} (${decrypted.length}B) error=${(parseErr as Error)?.message}`);
        throw parseErr;
    }
};
