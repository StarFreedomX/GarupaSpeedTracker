/**
 * 深度调试：dump userProfileSituation 的原始 protobuf 字节，
 * 检查 situationId 是否真的在二进制数据中
 *
 * 用法：npx tsx src/test/debug-sid-zero-raw.ts
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import {
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_SERVER_BASES,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
} from "@/config";

const TARGET_UID = 92161183;
const SERVER = 0;
const EVENT_ID = 338;

const resolveServerValue = (values: string[], server: number): string => {
    const raw = values[server] ?? values[0] ?? "";
    if (!raw.trim() || raw.trim() === "-") throw new Error(`missing config for server ${server}`);
    return raw.trim();
};

function readVarint(buf: Buffer, offset: number): { value: number; offset: number } | null {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buf.length) {
        const byte = buf[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
        if (shift > 56) return null;
    }
    return null;
}

interface ProtoNode {
    field: number;
    wireType: number;
    value?: number | bigint;
    bytes?: Buffer;
    children?: ProtoNode[];
}

function parseRaw(buf: Buffer): ProtoNode[] {
    const nodes: ProtoNode[] = [];
    let off = 0;
    while (off < buf.length) {
        const key = readVarint(buf, off);
        if (!key) break;
        off = key.offset;
        if (key.value === 0) break;
        const field = key.value >> 3;
        const wireType = key.value & 7;
        if (wireType === 0) {
            const v = readVarint(buf, off);
            if (!v) break;
            off = v.offset;
            nodes.push({ field, wireType, value: v.value });
        } else if (wireType === 2) {
            const len = readVarint(buf, off);
            if (!len) break;
            off = len.offset;
            const end = off + len.value;
            if (end > buf.length) break;
            const inner = buf.subarray(off, end);
            off = end;
            const children = parseRaw(inner);
            nodes.push({ field, wireType, bytes: inner, children: children.length > 0 ? children : undefined });
        } else if (wireType === 1) {
            const end = off + 8;
            if (end > buf.length) break;
            nodes.push({ field, wireType, bytes: buf.subarray(off, end) });
            off = end;
        } else if (wireType === 5) {
            const end = off + 4;
            if (end > buf.length) break;
            nodes.push({ field, wireType, bytes: buf.subarray(off, end) });
            off = end;
        } else break;
    }
    return nodes;
}

function describeNode(node: ProtoNode, indent: number = 0): string {
    const prefix = "  ".repeat(indent);
    let desc = `${prefix}field=${node.field} wire=${node.wireType}`;
    if (node.value !== undefined) desc += ` varint=${node.value}`;
    if (node.bytes) desc += ` bytes=${node.bytes.length}B hex=${node.bytes.toString("hex").substring(0, 80)}`;
    return desc;
}

const PFS_FIELDS: Record<number, string> = { 1: "userId", 2: "situationId", 3: "illust", 4: "viewProfileSituationStatus" };

const main = async (): Promise<void> => {
    let clientVersion = "10.1.4";
    try {
        const r = await fetch(`https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band&t=${Date.now()}`);
        const d = (await r.json()) as { results?: Array<{ version?: string }> };
        const v = d?.results?.[0]?.version;
        if (v) clientVersion = v;
    } catch {}
    console.log(`Client version: ${clientVersion}\n`);

    const base = `https://${resolveServerValue(GARUPA_SERVER_BASES, SERVER).replace(/\/+$/, "")}/api/`;
    const uid = resolveServerValue(GARUPA_UIDS, SERVER);
    const url = new URL(`user/${uid}/event/${EVENT_ID}/medley/ranking`, base);

    const headers = {
        "User-Agent": resolveServerValue(GARUPA_USER_AGENTS, SERVER),
        "X-Unity-Version": resolveServerValue(GARUPA_UNITY_VERSIONS, SERVER),
        "X-ClientPlatform": resolveServerValue(GARUPA_CLIENT_PLATFORMS, SERVER),
        "X-ClientVersion": clientVersion,
        "X-Signature": resolveServerValue(GARUPA_UUIDS, SERVER),
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    } as const;

    const resp = await fetch(url.toString(), { headers });
    const encrypted = Buffer.from(await resp.arrayBuffer());
    const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_KEYS, SERVER)),
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_IVS, SERVER)),
    );
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const topNodes = parseRaw(decrypted);
    let topUsersMsg = topNodes.find((n) => n.field === 2);
    if (!topUsersMsg?.children) topUsersMsg = topNodes.find((n) => n.field === 1);
    if (!topUsersMsg?.children) {
        console.log("ERROR: top users field not found");
        return;
    }

    for (const entry of topUsersMsg.children) {
        if (!entry.children) continue;
        const uidField = entry.children.find((n) => n.field === 7 && n.value !== undefined);
        if (!uidField || uidField.value !== TARGET_UID) continue;

        console.log(`\n>>> Found uid=${TARGET_UID} <<<\n`);
        console.log("--- All fields ---");
        for (const f of entry.children) console.log(describeNode(f));

        const pfs = entry.children.find((n) => n.field === 11);
        console.log(`\n--- userProfileSituation (field 11) ---`);
        console.log(`Raw bytes: ${pfs?.bytes?.length ?? 0}B`);
        if ((pfs?.bytes?.length ?? 0) === 0) {
            console.log(">>> EMPTY MESSAGE (0 bytes) — no profile card! parseUser produces sid=0 <<<");
        } else if (pfs?.children) {
            for (const c of pfs.children) {
                const name = PFS_FIELDS[c.field] ?? `field_${c.field}`;
                if (c.value !== undefined) console.log(`  ${name}: ${c.value}`);
                else if (c.bytes) console.log(`  ${name}: "${c.bytes.toString("utf8")}"`);
            }
        } else if (pfs?.bytes) {
            let off = 0;
            while (off < pfs.bytes.length) {
                const key = readVarint(pfs.bytes, off);
                if (!key) break;
                off = key.offset;
                const f = key.value >> 3,
                    w = key.value & 7;
                if (w === 0) {
                    const v = readVarint(pfs.bytes, off);
                    if (!v) break;
                    off = v.offset;
                    console.log(`  ${PFS_FIELDS[f] ?? `field_${f}`}: ${v.value}`);
                } else if (w === 2) {
                    const l = readVarint(pfs.bytes, off);
                    if (!l) break;
                    off = l.offset;
                    console.log(`  ${PFS_FIELDS[f] ?? `field_${f}`}: "${pfs.bytes.subarray(off, off + l.value).toString("utf8")}"`);
                    off += l.value;
                } else break;
            }
        }

        // Also dump userSituationList for cross-check
        const usl = entry.children.find((n) => n.field === 10);
        if (usl?.children) {
            console.log(`\n--- userSituationList (field 10): ${usl.children.length} cards ---`);
            for (const card of usl.children.slice(0, 3)) {
                if (!card.children) continue;
                const sid = card.children.find((c) => c.field === 2 && c.value !== undefined)?.value;
                const illust = card.children.find((c) => c.field === 9)?.bytes?.toString("utf8");
                const lv = card.children.find((c) => c.field === 3)?.value;
                console.log(`  sid=${sid}, illust="${illust}", level=${lv}`);
            }
        }
        return;
    }
    console.log(`\nuid=${TARGET_UID} not found`);
};

main().catch(console.error);
