// noinspection DuplicatedCode

/**
 * 活动 Ranking 接口探查脚本
 *
 * 验证不同活动类型的 protobuf 字段映射，确认 schema 正确性。
 *
 * 用法：
 *   npx tsx src/test/research-event-ranking.ts 0 335 challenge
 *   npx tsx src/test/research-event-ranking.ts 0 335 challenge 748
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import {
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_CLIENT_VERSIONS,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_SERVER_BASES,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
} from "@/config";
import { GarupaParser } from "@/parsers/GarupaParser";
import {
    userChallengeEventRankingResponseSchema,
    userLiveTryEventRankingResponseSchema,
    userMedleyEventRankingResponseSchema,
    userMissionLiveEventRankingResponseSchema,
    userStoryEventRankingResponseSchema,
    userTeamLiveFestivalEventRankingResponseSchema,
    userVersusEventRankingResponseSchema,
} from "@/types/garupaSchema";

// ============================================================================
// Protobuf 原始探测
// ============================================================================

interface ProbeNode {
    field: number;
    wireType: number;
    data: number | Buffer | ProbeNode[];
}

const readVarint = (buffer: Buffer, offset: number): { value: number; offset: number } => {
    let value = 0;
    let shift = 0;
    let cursor = offset;

    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) {
            return { value, offset: cursor };
        }
        shift += 7;
        if (shift > 56) {
            throw new Error("varint too large");
        }
    }
    throw new Error("unexpected end while reading varint");
};

const parseProbe = (buffer: Buffer, maxDepth: number = 3): ProbeNode[] => {
    const out: ProbeNode[] = [];
    let offset = 0;

    while (offset < buffer.length) {
        const key = readVarint(buffer, offset);
        offset = key.offset;
        if (key.value === 0) break;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 0) {
            const val = readVarint(buffer, offset);
            offset = val.offset;
            out.push({ field, wireType, data: val.value });
            continue;
        }

        if (wireType === 2) {
            const len = readVarint(buffer, offset);
            offset = len.offset;
            const end = offset + len.value;
            if (end > buffer.length) break;
            const inner = buffer.subarray(offset, end);
            offset = end;
            if (maxDepth > 1) {
                const nested = parseProbe(inner, maxDepth - 1);
                out.push({ field, wireType, data: nested });
            } else {
                out.push({ field, wireType, data: inner });
            }
            continue;
        }

        if (wireType === 1) {
            const end = offset + 8;
            if (end > buffer.length) break;
            out.push({ field, wireType, data: buffer.subarray(offset, end) });
            offset = end;
            continue;
        }

        if (wireType === 5) {
            const end = offset + 4;
            if (end > buffer.length) break;
            out.push({ field, wireType, data: buffer.subarray(offset, end) });
            offset = end;
            continue;
        }
        break;
    }
    return out;
};

const describeProbe = (nodes: ProbeNode[], indent: number = 0): string[] => {
    const lines: string[] = [];
    const prefix = "  ".repeat(indent);
    for (const node of nodes) {
        if (node.wireType === 2 && Array.isArray(node.data)) {
            lines.push(`${prefix}field=${node.field} (message, ${node.data.length} entries)`);
            lines.push(...describeProbe(node.data, indent + 1));
        } else if (node.wireType === 2 && Buffer.isBuffer(node.data)) {
            const buf = node.data;
            const hex = buf.subarray(0, Math.min(64, buf.length)).toString("hex");
            lines.push(`${prefix}field=${node.field} (bytes, len=${buf.length}, hex=${hex}...)`);
        } else {
            lines.push(`${prefix}field=${node.field} (wire=${node.wireType}, value=${String(node.data)})`);
        }
    }
    return lines;
};

// ============================================================================
// Network helpers
// ============================================================================

const toBaseUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "-") throw new Error("invalid base url config");
    return /^https?:\/\//i.test(trimmed) ? (trimmed.endsWith("/") ? trimmed : `${trimmed}/`) : `https://${trimmed.replace(/\/+$/, "")}/api/`;
};

const resolveServerValue = (values: string[], server: number): string => {
    const raw = values[server] ?? values[0] ?? "";
    if (!raw.trim() || raw.trim() === "-") throw new Error(`missing config for server ${server}`);
    return raw.trim();
};

const fetchAndDecrypt = async (server: number, url: URL): Promise<Buffer> => {
    const headers = {
        "User-Agent": resolveServerValue(GARUPA_USER_AGENTS, server),
        "X-Unity-Version": resolveServerValue(GARUPA_UNITY_VERSIONS, server),
        "X-ClientPlatform": resolveServerValue(GARUPA_CLIENT_PLATFORMS, server),
        "X-ClientVersion": resolveServerValue(GARUPA_CLIENT_VERSIONS, server),
        "X-Signature": resolveServerValue(GARUPA_UUIDS, server),
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    } as const;

    const response = await fetch(url.toString(), { headers });
    console.log(`HTTP status: ${response.status}`);

    const encrypted = Buffer.from(await response.arrayBuffer());
    const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_KEYS, server)),
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_IVS, server)),
    );
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

// ============================================================================
// Schema 映射
// ============================================================================

const SCHEMA_MAP: Record<string, { name: string; schema: Record<number, unknown> }> = {
    medley: { name: "userMedleyEventRankingResponseSchema", schema: userMedleyEventRankingResponseSchema },
    challenge: { name: "userChallengeEventRankingResponseSchema", schema: userChallengeEventRankingResponseSchema },
    versus: { name: "userVersusEventRankingResponseSchema", schema: userVersusEventRankingResponseSchema },
    live_try: { name: "userLiveTryEventRankingResponseSchema", schema: userLiveTryEventRankingResponseSchema },
    story: { name: "userStoryEventRankingResponseSchema", schema: userStoryEventRankingResponseSchema },
    mission_live: { name: "userMissionLiveEventRankingResponseSchema", schema: userMissionLiveEventRankingResponseSchema },
    team_live_festival: { name: "userTeamLiveFestivalEventRankingResponseSchema", schema: userTeamLiveFestivalEventRankingResponseSchema },
};

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
    const server = Number(process.argv[2] ?? 0);
    const eventId = Number(process.argv[3] ?? 335);
    const eventType = process.argv[4] ?? "challenge";
    const mid = process.argv[5] ? Number(process.argv[5]) : undefined;

    const schemaEntry = SCHEMA_MAP[eventType];
    if (!schemaEntry) {
        console.error(`Unknown event type: ${eventType}`);
        console.error(`Supported: ${Object.keys(SCHEMA_MAP).join(", ")}`);
        process.exit(1);
    }

    const base = toBaseUrl(resolveServerValue(GARUPA_SERVER_BASES, server));
    const uid = resolveServerValue(GARUPA_UIDS, server);

    const url = new URL(`user/${uid}/event/${eventId}/${eventType}/ranking`, base);
    if (mid !== undefined) {
        url.searchParams.set("mid", String(mid));
    }

    console.log(`=== Event Ranking Research ===`);
    console.log(`server: ${server}, eventId: ${eventId}, eventType: ${eventType}, mid: ${mid ?? "none"}`);
    console.log(`URL: ${url.toString()}`);
    console.log();

    // 1. 获取解密
    console.log("--- Fetching & Decrypting ---");
    const payload = await fetchAndDecrypt(server, url);
    console.log(`Decrypted payload size: ${payload.length} bytes`);
    console.log();

    // 2. 原始探测
    console.log("--- Raw Probe (depth=3) ---");
    const probe = parseProbe(payload, 3);
    const probeLines = describeProbe(probe);
    for (const line of probeLines.slice(0, 80)) {
        console.log(line);
    }
    if (probeLines.length > 80) {
        console.log(`... (${probeLines.length - 80} more lines)`);
    }
    console.log();

    // 3. Schema 解析
    console.log(`--- Schema Decode (${schemaEntry.name}) ---`);
    try {
        const parser = new GarupaParser();
        const decoded = parser.decode(payload, schemaEntry.schema as import("@/types/garupaSchema/schemaDefinition").SchemaDefinition);
        console.dir(decoded, { depth: 4, maxArrayLength: 5 });
    } catch (err) {
        console.error("Schema decode failed:", err);
    }

    // 4. 如果有 mid，检查 score 字段
    if (mid !== undefined) {
        console.log();
        console.log("--- Music Ranking Check ---");
        console.log(`Requested with mid=${mid}`);
        const probeTop = probe.filter((n) => n.field === 1 || n.field === 2 || n.field === 3 || n.field === 4 || n.field === 5 || n.field === 6);
        console.log(`Top-level fields found: ${probeTop.map((n) => n.field).join(", ")}`);

        // 探测是否有嵌套的歌榜数据
        const nestedMessages = probe.filter((n): n is ProbeNode & { data: ProbeNode[] } => n.wireType === 2 && Array.isArray(n.data));
        for (const msg of nestedMessages) {
            console.log(`  Nested message at field=${msg.field}: ${msg.data.length} entries`);
        }
    }
};

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
