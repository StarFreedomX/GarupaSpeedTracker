/**
 * 国服 API 关键测试：
 * 1. 用 newRequestId 直接请求 event ranking
 * 2. 用 newRequestId 直接请求 monthly ranking
 * 3. 验证 X-Requestid 重试机制
 */
import { Buffer } from "node:buffer";
import { bandoriEventRankingParser } from "@/parsers/GarupaEventRankingParser";
import { bandoriMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

async function fetchDecrypt(url: string, rid: string): Promise<{ decrypted: Buffer; status: number }> {
    const response = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const raw = Buffer.from(await response.arrayBuffer());
    return { decrypted: decryptCn(raw), status: response.status };
}

function extractRidFromError(decrypted: Buffer): string | null {
    const match = decrypted.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return match?.[1] ?? null;
}

async function testEventRanking(rid: string, label: string, eventId: number, protoEventType: string) {
    console.log(`\n--- ${label} ---`);
    const urlSeg = eventTypeToUrlSegment(protoEventType);
    const url = new URL(`user/${CN_UID}/event/${eventId}/${urlSeg}/ranking`, CN_BASE_URL).toString();
    console.log(`RID: ${rid.substring(0, 16)}...`);

    const { decrypted, status } = await fetchDecrypt(url, rid);
    console.log(`HTTP ${status}, ${decrypted.length}B`);

    if (status === 200 && decrypted.length > 100) {
        const parsed = bandoriEventRankingParser.parse(decrypted, protoEventType);
        console.log(`✅ Top:${parsed.eventPointTopUsers?.length ?? 0} Border:${parsed.eventPointBorderUsers?.length ?? 0}`);
        if (parsed.eventPointTopUsers?.length) {
            for (const u of parsed.eventPointTopUsers.slice(0, 3)) {
                console.log(`  #${u.tier} ${u.name} pt:${u.point}`);
            }
        }
        return true;
    } else {
        const newRid = extractRidFromError(decrypted);
        console.log(`❌ 失败. newRequestId: ${newRid ?? "无"}`);
        if (decrypted.length > 0 && decrypted.length < 500) {
            const text = decrypted.toString("utf8").replace(/[^\x20-\x7e]/g, ".");
            console.log(`  消息: ${text.substring(0, 200)}`);
        }
        return false;
    }
}

async function testMonthlyRanking(rid: string, label: string, monthlyId: number) {
    console.log(`\n--- ${label} ---`);
    const url = new URL(`user/${CN_UID}/monthlyranking/${monthlyId}/ranking`, CN_BASE_URL).toString();
    console.log(`RID: ${rid.substring(0, 16)}...`);

    const { decrypted, status } = await fetchDecrypt(url, rid);
    console.log(`HTTP ${status}, ${decrypted.length}B`);

    if (status === 200 && decrypted.length > 100) {
        const parsed = bandoriMonthlyRankingParser.parse(decrypted);
        console.log(`✅ Top:${parsed.monthlyRankingPointTopUsers?.length ?? 0} Border:${parsed.monthlyRankingPointBorderUsers?.length ?? 0}`);
        if (parsed.monthlyRankingPointTopUsers?.length) {
            for (const u of parsed.monthlyRankingPointTopUsers.slice(0, 3)) {
                console.log(`  #${u.tier} ${u.name} pt:${u.point}`);
            }
        }
        return true;
    } else {
        const newRid = extractRidFromError(decrypted);
        console.log(`❌ 失败. newRequestId: ${newRid ?? "无"}`);
        if (decrypted.length > 0 && decrypted.length < 500) {
            const text = decrypted.toString("utf8").replace(/[^\x20-\x7e]/g, ".");
            console.log(`  消息: ${text.substring(0, 200)}`);
        }
        return false;
    }
}

async function main() {
    console.log("=== 国服 X-Requestid 关键测试 ===\n");

    // 1. 从 monthly 获取 rid
    const monthlyUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const { decrypted: errDec } = await fetchDecrypt(monthlyUrl, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const rid = extractRidFromError(errDec);
    console.log(`从 monthly 错误响应提取 rid: ${rid}\n`);

    if (!rid) {
        console.log("无法获取 rid，退出");
        return;
    }

    // 2. 测试 event ranking
    const eventOk = await testEventRanking(rid, "Event ranking (316 live_try) with rid", 316, "live_try");

    // 3. 测试 monthly ranking
    const _monthlyOk = await testMonthlyRanking(rid, "Monthly ranking (18) with same rid", 18);

    // 4. 验证 rid 是否一次性
    if (eventOk) {
        console.log("\n>>> 验证 rid 复用性...");
        await testEventRanking(rid, "Event ranking 第二次 (同一 rid)", 316, "live_try");
    }

    console.log("\n========== 测试完成 ==========");
}

main().catch(console.error);
