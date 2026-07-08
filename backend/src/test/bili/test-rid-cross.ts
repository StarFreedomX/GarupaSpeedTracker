/**
 * 最终验证：X-Requestid 跨端点/跨资源复用性
 */
import { Buffer } from "node:buffer";
import { bandoriMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function randRid(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function req(url: string, rid: string) {
    const r = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const raw = Buffer.from(await r.arrayBuffer());
    return { decrypted: raw.length > 0 ? decryptCn(raw) : raw, status: r.status, rawSize: raw.length };
}

function extractRid(decrypted: Buffer): string | null {
    const m = decrypted.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

async function main() {
    console.log("=== X-Requestid 复用性最终验证 ===\n");

    // 1. 获取 monthly ranking 的 rid（从错误响应中提取）
    console.log("1. 从 monthly ranking 18 错误响应获取 rid...");
    const { decrypted: errRes } = await req(new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString(), randRid());
    const monthlyRid = extractRid(errRes);
    if (!monthlyRid) throw new Error("无法获取 rid");
    console.log(`   rid: ${monthlyRid}\n`);

    // 2. 用这个 rid 请求 monthly ranking 18
    console.log("2. 用 rid 请求 monthly ranking 18...");
    const { decrypted: d18, status: s18 } = await req(new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString(), monthlyRid);
    console.log(`   HTTP ${s18}, ${d18.length}B`);
    if (d18.length > 0) {
        const p = bandoriMonthlyRankingParser.parse(d18);
        console.log(`   Top:${p.monthlyRankingPointTopUsers?.length ?? 0} Border:${p.monthlyRankingPointBorderUsers?.length ?? 0}`);
    }

    // 3. 同一 rid 请求 monthly ranking 17（不同期月榜）
    console.log("\n3. 同一 rid 请求 monthly ranking 17...");
    const { decrypted: d17, status: s17 } = await req(new URL(`user/${CN_UID}/monthlyranking/17/ranking`, CN_BASE_URL).toString(), monthlyRid);
    console.log(`   HTTP ${s17}, ${d17.length}B`);
    if (d17.length > 0 && s17 === 200) {
        try {
            const p = bandoriMonthlyRankingParser.parse(d17);
            console.log(`   ✅ 跨期月榜成功! Top:${p.monthlyRankingPointTopUsers?.length ?? 0} Border:${p.monthlyRankingPointBorderUsers?.length ?? 0}`);
        } catch (e) {
            console.log(`   ❌ 解析失败: ${(e as Error).message}`);
        }
    } else if (d17.length < 100 && s17 === 405) {
        const newRid = extractRid(d17);
        console.log(`   ⚠️ 需要新 rid. newRequestId: ${newRid?.substring(0, 16) ?? "无"}...`);
    } else {
        console.log(`   ⚠️ 空响应或错误`);
    }

    // 4. 同一 rid 请求 event ranking (使用映射)
    console.log("\n4. 同一 rid 请求 event ranking 316...");
    const urlSeg = eventTypeToUrlSegment("live_try");
    const { decrypted: e316, status: se316 } = await req(new URL(`user/${CN_UID}/event/316/${urlSeg}/ranking`, CN_BASE_URL).toString(), monthlyRid);
    console.log(`   HTTP ${se316}, ${e316.length}B`);
    if (e316.length > 100 && se316 === 200) {
        console.log(`   ✅ 跨端点成功! (event 数据仍可用)`);
    } else if (e316.length === 0) {
        console.log(`   ⚠️ 空响应（event 数据窗口已关闭）`);
    } else if (se316 === 405) {
        const newRid = extractRid(e316);
        console.log(`   ⚠️ event 需要独立 rid. newRequestId: ${newRid?.substring(0, 16) ?? "无"}...`);
    }

    // 5. 同一 rid 再请求 monthly 18（验证长时间复用）
    console.log("\n5. 同一 rid 再次请求 monthly 18（验证复用性）...");
    const { decrypted: d18b, status: s18b } = await req(new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString(), monthlyRid);
    console.log(`   HTTP ${s18b}, ${d18b.length}B`);
    if (d18b.length > 0) console.log(`   ✅ rid 仍然有效!`);

    console.log("\n=== 验证完成 ===");
}

main().catch(console.error);
