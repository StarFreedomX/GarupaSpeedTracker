/**
 * 验证日服 protobuf eventType + 检查客户端版本
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { GARUPA_ENCRYPTION_IVS, GARUPA_ENCRYPTION_KEYS, GARUPA_SERVER_BASES, GARUPA_UUIDS } from "@/config";

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

function decrypt(buf: Buffer): Buffer {
    const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(JP_KEY), Buffer.from(JP_IV));
    d.setAutoPadding(false);
    return Buffer.concat([d.update(buf), d.final()]);
}

function _readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0,
        shift = 0,
        cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
    }
    throw new Error("unexpected end");
}

async function main() {
    // 先获取 application 看当前版本要求
    console.log("1. 获取 JP application 版本信息...");
    const appHeaders = {
        "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
        "X-Unity-Version": "2021.3.45f2",
        "X-ClientPlatform": "Android",
        "X-Signature": JP_UUID,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };

    try {
        const ar = await fetch(`${JP_BASE}application`, { headers: appHeaders });
        const araw = Buffer.from(await ar.arrayBuffer());
        const adec = decrypt(araw);
        const text = adec.toString("utf8").replace(/[^\x20-\x7e]/g, ".");
        console.log(`  HTTP ${ar.status}, ${adec.length}B`);
        console.log(`  可读: ${text.substring(0, 200)}`);
    } catch (e) {
        console.log(`  application 失败: ${(e as Error).message}`);
    }

    // 用 10.1.1 版本获取 event info (返回 426)
    console.log("\n2. 用 clientVersion=10.1.1 获取 event info...");
    const headers10 = { ...appHeaders, "X-ClientVersion": "10.1.1" };
    const r10 = await fetch(`${JP_BASE}event`, { headers: headers10 });
    const raw10 = Buffer.from(await r10.arrayBuffer());
    const dec10 = decrypt(raw10);
    console.log(`  HTTP ${r10.status}, ${dec10.length}B`);
    console.log(
        `  raw text: ${dec10
            .toString("utf8")
            .replace(/[^\x20-\x7e]/g, ".")
            .substring(0, 200)}`,
    );
    console.log(`  hex: ${dec10.subarray(0, 48).toString("hex")}`);

    // 尝试从 Apple lookup 获取最新版本
    console.log("\n3. 查找最新客户端版本...");
    try {
        const lr = await fetch("https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band");
        const lj = (await lr.json()) as { results?: { version?: string }[] };
        const ver = lj.results?.[0]?.version;
        console.log(`  App Store 版本: ${ver ?? "未找到"}`);
    } catch (e) {
        console.log(`  Apple lookup 失败: ${(e as Error).message}`);
    }
}

main().catch((e) => console.error(e.message));
