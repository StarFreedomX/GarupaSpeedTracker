/**
 * 对比 T1（rank 1）和 uid=92161183 的 userProfileSituation vs userDeck.leader
 * 验证领队卡(userDeck.leader)和资料展示卡(userProfileSituation.situationId)是两个不同概念
 *
 * 用法：npx tsx src/test/debug-sid-zero-compare.ts
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
    let value = 0,
        shift = 0,
        cursor = offset;
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
    value?: number;
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
        const field = key.value >> 3,
            wireType = key.value & 7;
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

const DECK_FIELDS: Record<number, string> = {
    1: "deckId",
    2: "deckName",
    3: "leader",
    4: "member1",
    5: "member2",
    6: "member3",
    7: "member4",
    8: "bondsEffectIds",
    10: "deckType",
};
const PFS_FIELDS: Record<number, string> = { 1: "userId", 2: "situationId", 3: "illust", 4: "viewProfileSituationStatus" };

function dumpFields(nodes: ProtoNode[] | undefined, names: Record<number, string>, indent: string = "    "): void {
    if (!nodes?.length) {
        console.log(`${indent}(empty)`);
        return;
    }
    for (const n of nodes) {
        const name = names[n.field] ?? `field_${n.field}`;
        if (n.value !== undefined) console.log(`${indent}${name}: ${n.value}`);
        else if (n.bytes?.length) {
            if (name === "bondsEffectIds" && n.children)
                console.log(
                    `${indent}${name}: [${n.children
                        .filter((c) => c.value !== undefined)
                        .map((c) => c.value)
                        .join(", ")}]`,
                );
            else console.log(`${indent}${name}: "${n.bytes.toString("utf8")}"`);
        } else console.log(`${indent}${name}: (0 bytes - EMPTY)`);
    }
}

async function main() {
    let clientVersion = "10.1.4";
    try {
        const r = await fetch(`https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band&t=${Date.now()}`);
        const d = (await r.json()) as { results?: Array<{ version?: string }> };
        const v = d?.results?.[0]?.version;
        if (v) clientVersion = v;
    } catch {}

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
    const dec = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    const topNodes = parseRaw(dec);
    const topUsersMsg = topNodes.find((n) => n.field === 2);
    if (!topUsersMsg?.children) {
        console.log("Field 2 not found");
        return;
    }

    let t1Entry: ProtoNode | undefined, targetEntry: ProtoNode | undefined;
    for (const entry of topUsersMsg.children) {
        if (!entry.children) continue;
        const r = entry.children.find((n) => n.field === 5)?.value;
        const u = entry.children.find((n) => n.field === 7)?.value;
        if (r === 1) t1Entry = entry;
        if (u === TARGET_UID) targetEntry = entry;
    }

    function analyze(label: string, e: ProtoNode | undefined) {
        if (!e?.children) {
            console.log(`${label}: NOT FOUND\n`);
            return;
        }
        const nm = e.children.find((n) => n.field === 1)?.bytes?.toString("utf8") ?? "?";
        const rk = e.children.find((n) => n.field === 5)?.value;
        const uidV = e.children.find((n) => n.field === 7)?.value;
        const pt = e.children.find((n) => n.field === 6)?.value;
        const deck = e.children.find((n) => n.field === 9);
        const pfs = e.children.find((n) => n.field === 11);

        console.log(`${label}: rank=${rk}, uid=${uidV}, name="${nm}", point=${pt}`);
        console.log("\n--- userDeck (field 9) ---");
        dumpFields(deck?.children, DECK_FIELDS);
        console.log("\n--- userProfileSituation (field 11) ---");
        if (pfs?.children) {
            dumpFields(pfs.children, PFS_FIELDS);
        } else if ((pfs?.bytes?.length ?? 0) === 0) console.log("    >>> EMPTY (0 bytes) — no profile card <<<");
        else console.log(`    bytes=${pfs?.bytes?.length}B`);

        if (deck?.children) {
            const leader = deck.children.find((n) => n.field === 3)?.value;
            const pfsSid = pfs?.children?.find((n) => n.field === 2)?.value;
            console.log(`\n    Leader: ${leader ?? "?"}, Profile card: ${pfsSid ?? "undefined"} → ${leader === pfsSid ? "SAME" : "DIFFERENT"}`);
        }
        console.log();
    }

    console.log(`=== T1 vs uid=${TARGET_UID} comparison ===\n`);
    analyze("T1 (rank 1)", t1Entry);
    analyze(`Target (uid=${TARGET_UID})`, targetEntry);
}

main().catch(console.error);
