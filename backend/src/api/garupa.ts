import * as crypto from "node:crypto";
import {
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_CLIENT_VERSIONS,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_PACKAGE_URLS,
    GARUPA_SERVER_BASES,
    GARUPA_STATUS_POLL_INTERVAL_MS,
    GARUPA_STATUS_UNAVAILABILITY_THRESHOLD,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
    GARUPA_VERSION_CHECK_TIMEOUT_MS,
} from "@/config";
import { bandoriMonthlyRankingParser as garupaMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import type { MonthlyRankingBandoriRaw } from "@/types/monthlyRanking";

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

const resolveServerValue = (values: string[], server: number, label: string): string => {
    const raw = values[server] ?? values[0] ?? "";
    const normalized = raw.trim();
    if (!normalized || normalized === "-") {
        throw new Error(`${label} not configured for server ${server}`);
    }

    return normalized;
};

const resolveOptionalServerValue = (values: string[], server: number): string | undefined => {
    const raw = values[server] ?? values[0] ?? "";
    const normalized = raw.trim();
    if (!normalized || normalized === "-") {
        return undefined;
    }
    return normalized;
};

const getGarupaBaseUrl = (server: number): string => {
    const baseRaw = resolveServerValue(GARUPA_SERVER_BASES, server, "GARUPA_SERVER_BASES");
    const base = toBaseUrl(baseRaw);
    if (!base) {
        throw new Error(`Monthly ranking base URL is missing for server ${server}`);
    }

    return base;
};

const getGarupaUid = (server: number): string => resolveServerValue(GARUPA_UIDS, server, "GARUPA_UIDS");
const getGarupaUuid = (server: number): string => resolveServerValue(GARUPA_UUIDS, server, "GARUPA_UUIDS");
const getGarupaUnityVersion = (server: number): string => resolveServerValue(GARUPA_UNITY_VERSIONS, server, "GARUPA_UNITY_VERSIONS");
const getGarupaUserAgent = (server: number): string => resolveServerValue(GARUPA_USER_AGENTS, server, "GARUPA_USER_AGENTS");
const getGarupaClientPlatform = (server: number): string => resolveServerValue(GARUPA_CLIENT_PLATFORMS, server, "GARUPA_CLIENT_PLATFORMS");
const getGarupaEncryptionKey = (server: number): string => resolveServerValue(GARUPA_ENCRYPTION_KEYS, server, "GARUPA_ENCRYPTION_KEYS");
const getGarupaEncryptionIv = (server: number): string => resolveServerValue(GARUPA_ENCRYPTION_IVS, server, "GARUPA_ENCRYPTION_IVS");

const buildMonthlyRankingUrl = (server: number, monthlyId: number): string => {
    const base = getGarupaBaseUrl(server);
    const uid = getGarupaUid(server);
    const url = new URL(`user/${uid}/monthlyranking/${monthlyId}/ranking`, base);
    return url.toString();
};

const buildMonthlyRankingMasterListUrl = (server: number): string => {
    const base = getGarupaBaseUrl(server);
    const url = new URL("monthlyranking", base);
    return url.toString();
};

const toCipherBuffer = (value: string, label: string): Buffer => {
    const buffer = Buffer.from(value);
    if (buffer.length !== 16) {
        throw new Error(`${label} must be 16 bytes, got ${buffer.length}`);
    }
    return buffer;
};

export const getGarupaFallbackClientVersion = (server: number): string | undefined => resolveOptionalServerValue(GARUPA_CLIENT_VERSIONS, server);

export const getGarupaServerCount = (): number => GARUPA_SERVER_BASES.length;

export const getGarupaServerIds = (): number[] =>
    GARUPA_SERVER_BASES.map((value, index) => ({ value: value.trim(), index }))
        .filter((entry) => entry.value && entry.value !== "-")
        .map((entry) => entry.index);

export const getGarupaPackageUrl = (server: number): string => resolveServerValue(GARUPA_PACKAGE_URLS, server, "GARUPA_PACKAGE_URLS");

export const getGarupaStatusPollIntervalMs = (): number => GARUPA_STATUS_POLL_INTERVAL_MS;
export const getGarupaStatusUnavailabilityThreshold = (): number => GARUPA_STATUS_UNAVAILABILITY_THRESHOLD;
export const getGarupaVersionCheckTimeoutMs = (): number => GARUPA_VERSION_CHECK_TIMEOUT_MS;

export const createGarupaHeaders = (server: number, clientVersion: string) => {
    const uuid = getGarupaUuid(server);
    return {
        "User-Agent": getGarupaUserAgent(server),
        "X-Unity-Version": getGarupaUnityVersion(server),
        "X-ClientPlatform": getGarupaClientPlatform(server),
        "X-ClientVersion": clientVersion,
        "X-Signature": uuid,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    } as const;
};

const cipherKeyCache = new Map<number, Buffer>();
const cipherIvCache = new Map<number, Buffer>();

const getCipherKey = (server: number): Buffer => {
    const cached = cipherKeyCache.get(server);
    if (cached) {
        return cached;
    }
    const key = toCipherBuffer(getGarupaEncryptionKey(server), "GARUPA_ENCRYPTION_KEYS");
    cipherKeyCache.set(server, key);
    return key;
};

const getCipherIv = (server: number): Buffer => {
    const cached = cipherIvCache.get(server);
    if (cached) {
        return cached;
    }
    const iv = toCipherBuffer(getGarupaEncryptionIv(server), "GARUPA_ENCRYPTION_IVS");
    cipherIvCache.set(server, iv);
    return iv;
};

const decryptPayload = (server: number, payload: Buffer): Buffer => {
    const decipher = crypto.createDecipheriv("aes-128-cbc", getCipherKey(server), getCipherIv(server));
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(payload), decipher.final()]);
};

export const fetchMonthlyRankingBuffer = async (
    server: number,
    monthlyId: number,
    clientVersion: string,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    const url = buildMonthlyRankingUrl(server, monthlyId);
    const headers = createGarupaHeaders(server, clientVersion);

    const response = await fetch(url, { headers });
    const status = response.status;
    const arrayBuffer = await response.arrayBuffer();
    const bodyBuffer = Buffer.from(arrayBuffer);
    const decrypted = decryptPayload(server, bodyBuffer);
    return { decrypted, status, length: bodyBuffer.length };
};

export const fetchMonthlyRanking = async (server: number, monthlyId: number, clientVersion: string): Promise<MonthlyRankingBandoriRaw> => {
    const { decrypted, status } = await fetchMonthlyRankingBuffer(server, monthlyId, clientVersion);
    if (status < 200 || status >= 300) {
        throw new Error(`Monthly ranking HTTP ${status}`);
    }

    return garupaMonthlyRankingParser.parse(decrypted);
};

export const fetchMonthlyRankingMasterListBuffer = async (
    server: number,
    clientVersion: string,
): Promise<{ decrypted: Buffer; status: number; length: number }> => {
    const url = buildMonthlyRankingMasterListUrl(server);
    const headers = createGarupaHeaders(server, clientVersion);

    const response = await fetch(url, { headers });
    const status = response.status;
    const arrayBuffer = await response.arrayBuffer();
    const bodyBuffer = Buffer.from(arrayBuffer);
    const decrypted = decryptPayload(server, bodyBuffer);
    return { decrypted, status, length: bodyBuffer.length };
};

export const checkGarupaGameStatus = async (server: number, clientVersion: string, timeoutMs: number = 2000): Promise<boolean> => {
    const base = getGarupaBaseUrl(server);
    const url = new URL("application", base).toString();
    const headers = createGarupaHeaders(server, clientVersion);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        return res.ok;
    } catch (_e) {
        return false;
    } finally {
        clearTimeout(tid);
    }
};

/**
 * 等待直到服务器可用
 * @param server
 * @param clientVersion
 * @param pollIntervalMs
 * @param timeoutMs
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
