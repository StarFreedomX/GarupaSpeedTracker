/**
 * 扫描日服所有活动，找 live_try / livetry 类型的 eventType
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { GARUPA_ENCRYPTION_IVS, GARUPA_ENCRYPTION_KEYS, GARUPA_SERVER_BASES, GARUPA_UUIDS } from "@/config";
import type { GarupaMasterEventListResponse } from "@/types/garupaSchema";

const JP_INDEX = 0;

const resolveJp = (values: string[], label: string): string => {
    const v = values[JP_INDEX]?.trim() ?? "";
    if (!v || v === "-") throw new Error(`${label} not configured for JP`);
    return v;
};

const JP_BASE = `https://${resolveJp(GARUPA_SERVER_BASES, "GARUPA_SERVER_BASES").replace(/\/+$/, "")}/api/`;
const JP_KEY = resolveJp(GARUPA_ENCRYPTION_KEYS, "GARUPA_ENCRYPTION_KEYS");
const JP_IV = resolveJp(GARUPA_ENCRYPTION_IVS, "GARUPA_ENCRYPTION_IVS");
const JP_UUID = resolveJp(GARUPA_UUIDS, "GARUPA_UUIDS");
const CLIENT_VER = "10.1.3";

function decrypt(buf: Buffer): Buffer {
    const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(JP_KEY), Buffer.from(JP_IV));
    d.setAutoPadding(false);
    return Buffer.concat([d.update(buf), d.final()]);
}

async function main() {
    const headers: Record<string, string> = {
        "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
        "X-Unity-Version": "2021.3.45f2",
        "X-ClientPlatform": "Android",
        "X-ClientVersion": CLIENT_VER,
        "X-Signature": JP_UUID,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };

    const resp = await fetch(`${JP_BASE}event`, { headers });
    console.log(`HTTP ${resp.status}`);
    const raw = Buffer.from(await resp.arrayBuffer());
    const decrypted = decrypt(raw);
    console.log(`Size: ${decrypted.length}B`);

    // 用 GarupaParser 解码所有活动
    const { masterEventListSchema } = await import("@/types/garupaSchema");
    const { GarupaParser } = await import("@/parsers/GarupaParser");
    const parser = new GarupaParser();
    const decoded = parser.decode(decrypted, masterEventListSchema) as GarupaMasterEventListResponse;
    const entries = decoded.entries ?? [];

    console.log(`\n共 ${entries.length} 个活动:`);
    const typeCounts: Record<string, number> = {};
    for (const e of entries) {
        const t = e.eventType ?? "?";
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    console.log("类型分布:", JSON.stringify(typeCounts, null, 2));

    // 列出所有活动的 eventType
    console.log("\n最近 10 个活动:");
    for (const e of entries.slice(-10)) {
        console.log(`  ID:${e.eventId} Type:"${e.eventType}" Name:${e.eventName ?? "N/A"}`);
    }
}

main().catch((e) => console.error(e.message));
