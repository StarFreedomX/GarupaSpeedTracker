/**
 * 国服测试专用配置
 * 所有敏感值从 .env 读取，不硬编码在代码中。
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

const CN_SERVER_INDEX = 3;

const toList = (value: string | undefined, fallback: string[]): string[] => {
    if (!value) return fallback;
    const entries = value
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
    return entries.length > 0 ? entries : fallback;
};

const getServerValue = (list: string[], label: string): string => {
    const v = list[CN_SERVER_INDEX] ?? list[0] ?? "";
    if (!v || v === "-") throw new Error(`${label} not configured for CN server (index ${CN_SERVER_INDEX})`);
    return v;
};

const serverBases = toList(process.env.GARUPA_SERVER_BASES, []);
const uids = toList(process.env.GARUPA_UIDS, []);
const uuids = toList(process.env.GARUPA_UUIDS, []);
const clientVersions = toList(process.env.GARUPA_CLIENT_VERSIONS, []);
const encKeys = toList(process.env.GARUPA_ENCRYPTION_KEYS, []);
const encIvs = toList(process.env.GARUPA_ENCRYPTION_IVS, []);
const cids = toList(process.env.GARUPA_CIDS, []);
const pids = toList(process.env.GARUPA_PIDS, []);

export const CN_BASE_URL = `https://${getServerValue(serverBases, "GARUPA_SERVER_BASES").replace(/\/+$/, "")}/api/`;
export const CN_UID = getServerValue(uids, "GARUPA_UIDS");
export const CN_UUID = getServerValue(uuids, "GARUPA_UUIDS");
export const CN_CLIENT_VERSION = getServerValue(clientVersions, "GARUPA_CLIENT_VERSIONS");
export const CN_ENCRYPTION_KEY = getServerValue(encKeys, "GARUPA_ENCRYPTION_KEYS");
export const CN_ENCRYPTION_IV = getServerValue(encIvs, "GARUPA_ENCRYPTION_IVS");
const cnChannelId = getServerValue(cids, "GARUPA_CIDS");
const cnPlatformId = getServerValue(pids, "GARUPA_PIDS");

export function buildCnRankingHeaders(requestId: string): Record<string, string> {
    return {
        "X-ClientVersion": CN_CLIENT_VERSION,
        "X-PlatformID": cnPlatformId,
        "X-ChannelID": cnChannelId,
        "X-Signature": CN_UUID,
        "X-Requestid": requestId,
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };
}

export function buildCnInfoHeaders(): Record<string, string> {
    return {
        "X-ClientVersion": CN_CLIENT_VERSION,
        "X-PlatformID": cnPlatformId,
        "X-ChannelID": cnChannelId,
        "X-Signature": CN_UUID,
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };
}

export function decryptCn(encrypted: Buffer): Buffer {
    const decipher = require("node:crypto").createDecipheriv("aes-128-cbc", Buffer.from(CN_ENCRYPTION_KEY), Buffer.from(CN_ENCRYPTION_IV));
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
