/**
 * 研究 RID 握手链
 * 核心问题：405 body 里的 nonce 到底怎么用？需要几次握手？
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

const dotenvPath = require("node:path").resolve(__dirname, "..", "..", "..", ".env");
require("dotenv").config({ path: dotenvPath });
const RKEYS = (process.env.GARUPA_RKEYS ?? "-,-,-,-").split(",").map((s) => s.trim());
const CN_RKEY = RKEYS[3];

function randomRid(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function hash(rkey: string, nonce: string): string {
    return crypto
        .createHash("md5")
        .update(rkey + nonce)
        .digest("hex");
}

function extractNonce(decrypted: Buffer): string | null {
    const text = decrypted.toString("utf8");
    const m = text.match(/\[(?:newRequestId|X-Requestid):([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

async function req(url: string, rid: string) {
    const resp = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const raw = Buffer.from(await resp.arrayBuffer());
    const decrypted = raw.length > 0 ? decryptCn(raw) : raw;
    const respRid = resp.headers.get("x-requestid");
    return { status: resp.status, decrypted, respRid };
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    console.log("=== RID 握手链研究 ===\n");
    console.log(`RKEY: ${CN_RKEY}\n`);

    // 使用活动榜 endpoint（可能比月榜 18 更有数据）
    const url = new URL(`user/${CN_UID}/event/316/livetry/ranking`, CN_BASE_URL).toString();

    // 步骤 1: 随机 RID → 405 → 拿到 nonce N1
    console.log("步骤 1: 随机 RID → 405，拿 nonce N1");
    const r1 = await req(url, randomRid());
    const N1 = extractNonce(r1.decrypted);
    console.log(`  HTTP ${r1.status}, nonce N1 = ${N1}\n`);
    if (!N1) return;

    await sleep(500);

    // 步骤 2: MD5(rkey + N1) → ?
    console.log("步骤 2: MD5(rkey + N1) 作为 RID");
    const rid2 = hash(CN_RKEY, N1);
    const r2 = await req(url, rid2);
    const N2 = extractNonce(r2.decrypted);
    console.log(`  HTTP ${r2.status}, respRid=${r2.respRid ?? "null"}, body nonce N2 = ${N2}`);
    console.log(`  decrypted=${r2.decrypted.length}B`);
    if (r2.status === 200) {
        console.log(`  ✅ 步骤 2 就成功了！\n`);
    } else {
        console.log(`  ${r2.status === 405 ? "❌ 仍然 405" : "🤔"}`);
    }
    console.log();

    if (N2 && r2.status === 405) {
        await sleep(500);

        // 步骤 3: MD5(rkey + N2) → ?
        console.log("步骤 3: MD5(rkey + N2) 作为 RID");
        const rid3 = hash(CN_RKEY, N2);
        const r3 = await req(url, rid3);
        const N3 = extractNonce(r3.decrypted);
        console.log(`  HTTP ${r3.status}, respRid=${r3.respRid ?? "null"}, body nonce N3 = ${N3}`);
        console.log(`  decrypted=${r3.decrypted.length}B`);
        if (r3.status === 200) {
            console.log(`  ✅ 步骤 3 成功！需要 2 次握手 (1→2→3)`);
        } else {
            console.log(`  ${r3.status === 405 ? "❌ 仍然 405，可能需要更多次" : "🤔"}`);
        }
        console.log();

        if (N3 && r3.status === 405) {
            await sleep(500);

            // 步骤 4: MD5(rkey + N3) → ?
            console.log("步骤 4: MD5(rkey + N3) 作为 RID");
            const rid4 = hash(CN_RKEY, N3);
            const r4 = await req(url, rid4);
            console.log(`  HTTP ${r4.status}, respRid=${r4.respRid ?? "null"}`);
            console.log(`  decrypted=${r4.decrypted.length}B`);
            if (r4.status === 200) {
                console.log(`  ✅ 步骤 4 成功！需要 3 次握手`);
            } else {
                console.log(`  ❌ 3 次握手后仍失败`);
            }
        }
    }

    // =============================================
    // 如果某步获得了 200，测试核心问题：旧 RID 是否失效？
    // =============================================
    if (r2.status === 200) {
        console.log("\n=== 核心实验：旧 RID 是否失效？ ===\n");

        // 用成功请求的响应头 nonce 算出 RID-B
        if (r2.respRid) {
            const ridB = hash(CN_RKEY, r2.respRid);
            console.log(`从响应头 nonce 算出 RID-B: ${ridB}`);

            // 用 RID-B 请求
            await sleep(500);
            console.log(`\n用 RID-B 请求...`);
            const rB = await req(url, ridB);
            console.log(`  HTTP ${rB.status}, respRid=${rB.respRid ?? "null"}`);
            console.log(`  decrypted=${rB.decrypted.length}B`);

            // 回头用 RID-A (即 rid2) 请求
            await sleep(500);
            console.log(`\n回头用 RID-A (=旧的 rid2) 请求...`);
            const rAagain = await req(url, rid2);
            console.log(`  HTTP ${rAagain.status}`);
            const naAgain = extractNonce(rAagain.decrypted);
            if (rAagain.status === 200) {
                console.log(`  ✅ RID-A 仍然有效！（新 RID 不会使旧 RID 失效）`);
            } else if (rAagain.status === 405) {
                console.log(`  ⚠️  RID-A 已失效！返回 405，nonce: ${naAgain}`);
            }
        }
    }
}

main().catch(console.error);
