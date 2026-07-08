/**
 * 验证 X-Requestid 的生命周期和消费机制
 *
 * 关键问题：
 * 1. X-Requestid 是一次性的还是可重复使用？
 * 2. 不同端点是否共享 rid 状态？
 * 3. 消费后重新获取 fresh rid 的流程
 */
import { Buffer } from "node:buffer";
import { bandoriEventRankingParser } from "@/parsers/GarupaEventRankingParser";
import { bandoriMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function randomRid(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function fetchDecrypt(url: string, rid: string): Promise<{ decrypted: Buffer; status: number }> {
    const response = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const raw = Buffer.from(await response.arrayBuffer());
    return { decrypted: raw.length > 0 ? decryptCn(raw) : raw, status: response.status };
}

function extractNewRid(decrypted: Buffer): string | null {
    const match = decrypted.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return match?.[1] ?? null;
}

async function getFreshRid(endpoint: string): Promise<string> {
    const url = new URL(endpoint, CN_BASE_URL).toString();
    const { decrypted } = await fetchDecrypt(url, randomRid());
    const newRid = extractNewRid(decrypted);
    if (!newRid) throw new Error(`无法从 ${endpoint} 获取 newRequestId`);
    return newRid;
}

async function main() {
    console.log("=== X-Requestid 生命周期验证 ===\n");

    // 实验 1: monthly ranking rid 重复使用
    console.log("实验1: Monthly ranking rid 重复使用");
    console.log("-".repeat(40));

    const mRid = await getFreshRid(`user/${CN_UID}/monthlyranking/18/ranking`);
    console.log(`获取 monthly rid: ${mRid.substring(0, 16)}...`);

    const mUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();

    // 第一次
    {
        const { decrypted, status } = await fetchDecrypt(mUrl, mRid);
        console.log(`第1次: HTTP ${status}, ${decrypted.length}B`);
        if (status === 200 && decrypted.length > 100) {
            const p = bandoriMonthlyRankingParser.parse(decrypted);
            console.log(`  ✅ Top:${p.monthlyRankingPointTopUsers?.length ?? 0} Border:${p.monthlyRankingPointBorderUsers?.length ?? 0}`);
        }
    }

    // 第二次（同一 rid）
    {
        const { decrypted, status } = await fetchDecrypt(mUrl, mRid);
        console.log(`第2次 (同一 rid): HTTP ${status}, ${decrypted.length}B`);
        if (status === 200 && decrypted.length > 100) console.log(`  ✅ 仍可使用`);
        else {
            const newRid = extractNewRid(decrypted);
            if (newRid) console.log(`  ❌ 已消费, newRid: ${newRid.substring(0, 16)}...`);
        }
    }

    // 实验 2: event ranking rid 重复使用
    console.log(`\n实验2: Event ranking rid 重复使用`);
    console.log("-".repeat(40));

    const eRid = await getFreshRid(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`);
    console.log(`获取 event rid: ${eRid.substring(0, 16)}...`);

    const eUrl = new URL(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`, CN_BASE_URL).toString();

    // 第一次
    {
        const { decrypted, status } = await fetchDecrypt(eUrl, eRid);
        console.log(`第1次: HTTP ${status}, ${decrypted.length}B`);
        if (status === 200 && decrypted.length > 100) {
            const p = bandoriEventRankingParser.parse(decrypted, "live_try");
            console.log(`  ✅ Top:${p.eventPointTopUsers?.length ?? 0} Border:${p.eventPointBorderUsers?.length ?? 0}`);
        }
    }

    // 第二次（同一 rid）
    {
        const { decrypted, status } = await fetchDecrypt(eUrl, eRid);
        console.log(`第2次 (同一 rid): HTTP ${status}, ${decrypted.length}B`);
        if (status === 200 && decrypted.length > 100) console.log(`  ✅ 仍可使用`);
        else {
            const newRid = extractNewRid(decrypted);
            if (newRid) console.log(`  ❌ 已消费, newRid: ${newRid.substring(0, 16)}...`);
        }
    }

    console.log("\n========== 验证完成 ==========");
}

main().catch(console.error);
