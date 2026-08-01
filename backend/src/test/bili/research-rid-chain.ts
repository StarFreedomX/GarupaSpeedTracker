/**
 * RID 链建立 + 旧 RID 过期测试
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { CN_BASE_URL, CN_UID, decryptCn } from "./config";

const dotenvPath = require("node:path").resolve(__dirname, "..", "..", "..", ".env");
require("dotenv").config({ path: dotenvPath });
const RKEYS = (process.env.GARUPA_RKEYS ?? "-,-,-,-").split(",").map((s) => s.trim());
const CN_RKEY = RKEYS[3];
const CN_UUID = process.env.GARUPA_UUIDS?.split(",")[3]?.trim() ?? "";
const CN_CID = process.env.GARUPA_CIDS?.split(",")[3]?.trim() ?? "";
const CN_PID = process.env.GARUPA_PIDS?.split(",")[3]?.trim() ?? "";

function randomRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function hash(rkey: string, nonce: string): string {
    return crypto
        .createHash("md5")
        .update(rkey + nonce)
        .digest("hex");
}

function gameHeaders(rid: string): Record<string, string> {
    const h: Record<string, string> = {
        "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
        "X-Unity-Version": "2021.3.45f2",
        "X-ClientPlatform": "Android",
        "X-ClientVersion": "9.4.4",
        "X-Signature": CN_UUID,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
        "X-Requestid": rid,
    };
    if (CN_CID && CN_CID !== "-") h["X-ChannelID"] = CN_CID;
    if (CN_PID && CN_PID !== "-") h["X-PlatformID"] = CN_PID;
    return h;
}

function extractNewRequestId(body: Buffer): string | null {
    const m = body.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log("=== RID 链建立 + 过期测试 ===\n");
    const url = new URL(`user/${CN_UID}/event/317/challenge/ranking`, CN_BASE_URL).toString();

    // 步骤 0: 随机 RID → 405 → 拿 newRequestId
    const r0 = await fetch(url, { headers: gameHeaders(randomRid()) });
    const dec0 = decryptCn(Buffer.from(await r0.arrayBuffer()));
    const recoverRid = extractNewRequestId(dec0);
    console.log(`步骤 0: 随机 RID → HTTP ${r0.status}`);
    console.log(`  newRequestId: ${recoverRid}`);
    if (r0.status !== 405 || !recoverRid) {
        console.log("❌ 未拿到 newRequestId");
        return;
    }

    await sleep(500);

    // 步骤 1: 用 newRequestId 直接当 RID 重试（对齐生产代码 405 恢复）
    console.log(`\n步骤 1: 用 newRequestId 直接重试`);
    const r1 = await fetch(url, { headers: gameHeaders(recoverRid) });
    const dec1 = decryptCn(Buffer.from(await r1.arrayBuffer()));
    const hdr1 = r1.headers.get("x-requestid");
    console.log(`  HTTP ${r1.status}, hdrNonce=${hdr1 ?? "null"}, len=${dec1.length}B`);
    if (r1.status !== 200 || !hdr1) {
        console.log("❌ 恢复失败");
        return;
    }
    const nonce1 = hdr1;

    await sleep(500);

    // 步骤 2: MD5(rkey + nonce1) → 发第一条正常请求
    const rid2 = hash(CN_RKEY, nonce1);
    console.log(`\n步骤 2: RID-2 = MD5(rkey + nonce1) = ${rid2}`);
    const r2 = await fetch(url, { headers: gameHeaders(rid2) });
    const dec2 = decryptCn(Buffer.from(await r2.arrayBuffer()));
    const hdr2 = r2.headers.get("x-requestid");
    console.log(`  HTTP ${r2.status}, hdrNonce=${hdr2 ?? "null"}, len=${dec2.length}B`);
    if (r2.status !== 200 || !hdr2) {
        console.log("❌ RID-2 失败");
        return;
    }
    const nonce2 = hdr2;

    await sleep(500);

    // 步骤 3: MD5(rkey + nonce2) → 第二条
    const rid3 = hash(CN_RKEY, nonce2);
    console.log(`\n步骤 3: RID-3 = MD5(rkey + nonce2) = ${rid3}`);
    const r3 = await fetch(url, { headers: gameHeaders(rid3) });
    const dec3 = decryptCn(Buffer.from(await r3.arrayBuffer()));
    const hdr3 = r3.headers.get("x-requestid");
    console.log(`  HTTP ${r3.status}, hdrNonce=${hdr3 ?? "null"}, len=${dec3.length}B`);
    if (r3.status !== 200) {
        console.log("❌ RID-3 失败");
        return;
    }

    console.log(`\n✅ RID 链建立成功！ recoverRid → RID-2 → RID-3`);
    console.log(`   RID-2 = ${rid2}`);
    console.log(`   RID-3 = ${rid3}`);

    await sleep(500);

    // ===== 核心测试 1: 用了 RID-3 后，回头用 RID-2 =====
    console.log(`\n=== 核心测试 1: RID-3 成功后，回头用 RID-2 ===`);
    const rBack2 = await fetch(url, { headers: gameHeaders(rid2) });
    const decBack2 = decryptCn(Buffer.from(await rBack2.arrayBuffer()));
    if (rBack2.status === 200) {
        console.log(`  HTTP 200 → ✅ RID-2 仍有效（新 RID 不会使旧 RID 失效）`);
    } else if (rBack2.status === 405) {
        const nr = extractNewRequestId(decBack2);
        console.log(`  HTTP 405 → ⚠️ RID-2 已失效！ newRequestId: ${nr}`);
    } else {
        console.log(`  HTTP ${rBack2.status} → 意外`);
    }

    await sleep(500);

    // ===== 核心测试 2: 回头用第一步的 newRequestId 直接值 =====
    console.log(`\n=== 核心测试 2: 回头用 newRequestId 直接值 ===`);
    const rBack1 = await fetch(url, { headers: gameHeaders(recoverRid) });
    const decBack1 = decryptCn(Buffer.from(await rBack1.arrayBuffer()));
    if (rBack1.status === 200) {
        console.log(`  HTTP 200 → ✅ 恢复 RID 直值仍有效`);
    } else if (rBack1.status === 405) {
        const nr = extractNewRequestId(decBack1);
        console.log(`  HTTP 405 → ⚠️ 恢复 RID 已失效！ newRequestId: ${nr}`);
    } else {
        console.log(`  HTTP ${rBack1.status}`);
    }
}

main().catch(console.error);
