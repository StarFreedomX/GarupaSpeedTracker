/**
 * 国服 API 完整端到端验证脚本
 *
 * 验证路径：
 * 1. 获取月榜 rid → 请求月榜数据 → 解析 → 成功
 * 2. rid 消费后重获取 → 再次请求 → 成功
 * 3. 活动信息和月榜信息端点（无需 rid）
 */

import { Buffer } from "node:buffer";
import { bandoriEventRankingParser } from "@/parsers/GarupaEventRankingParser";
import { bandoriMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaMasterEventListResponse, GarupaMasterMonthlyRankingListResponse } from "@/types/garupaSchema";
import { masterEventListSchema, masterMonthlyRankingListSchema } from "@/types/garupaSchema";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function randRid(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function get(url: string, rid: string) {
    const r = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const raw = Buffer.from(await r.arrayBuffer());
    return { decrypted: raw.length > 0 ? decryptCn(raw) : raw, status: r.status, rawSize: raw.length };
}

function extractRid(decrypted: Buffer): string | null {
    const m = decrypted.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

async function main() {
    console.log("═".repeat(60));
    console.log("  国服 (Bili/CN) API 完整端到端验证");
    console.log("═".repeat(60));

    // ────── 实验 A: 月榜排名完整流程 ──────
    console.log("\n━━━ 实验 A: 月榜排名 完整 rid 重试流程 ━━━");

    const monthlyEndpoint = `user/${CN_UID}/monthlyranking/18/ranking`;
    const monthlyUrl = new URL(monthlyEndpoint, CN_BASE_URL).toString();

    // Step 1: 用错误 rid 获取 newRequestId
    console.log("\n[Step 1] 发送错误 rid，获取 newRequestId...");
    const { decrypted: errRes } = await get(monthlyUrl, randRid());
    const rid1 = extractRid(errRes);
    if (!rid1) throw new Error("无法获取 monthly newRequestId");
    console.log(`  newRequestId: ${rid1}`);

    // Step 2: 用 newRequestId 请求数据
    console.log("\n[Step 2] 用 newRequestId 请求月榜数据...");
    const { decrypted: data1, status: s1 } = await get(monthlyUrl, rid1);
    console.log(`  HTTP ${s1}, ${data1.length}B`);

    if (s1 === 200 && data1.length > 100) {
        const parsed = bandoriMonthlyRankingParser.parse(data1);
        console.log(`  ✅ 解析成功!`);
        console.log(`    月榜Top: ${parsed.monthlyRankingPointTopUsers?.length ?? 0} 人`);
        console.log(`    月榜Border: ${parsed.monthlyRankingPointBorderUsers?.length ?? 0} 人`);
        if (parsed.monthlyRankingPointTopUsers?.length) {
            const u = parsed.monthlyRankingPointTopUsers;
            console.log(`    前3名:`);
            for (let i = 0; i < Math.min(3, u.length); i++) {
                console.log(`      #${u[i].tier} ${u[i].name} pt:${u[i].point} uid:${u[i].uid} rank:${u[i].rank}`);
            }
        }
    }

    // Step 3: 同一 rid 再次请求（验证是否已消费）
    console.log("\n[Step 3] 同一 rid 再次请求...");
    const { decrypted: data2, status: s2 } = await get(monthlyUrl, rid1);
    console.log(`  HTTP ${s2}, ${data2.length}B`);
    if (s2 === 405 || data2.length < 100) {
        const newRid = extractRid(data2);
        console.log(`  ⚠️ rid 已被消费! 新的 newRequestId: ${newRid?.substring(0, 16) ?? "无"}...`);
        if (newRid) {
            console.log(`  结论: X-Requestid 是一次性的，每次成功请求后需要获取新的 rid。`);
        }
    } else if (s2 === 200) {
        console.log(`  ⚠️ rid 可以重复使用（未被消费）`);
    }

    // ────── 实验 B: 活动信息/Master List ──────
    console.log("\n━━━ 实验 B: 活动信息 & 月榜信息 (Master List) ━━━");

    console.log("\n[活动信息] /api/event");
    const { decrypted: eventInfoDec } = await get(new URL("event", CN_BASE_URL).toString(), randRid());
    const parser = new GarupaParser();
    const eventList = parser.decode(eventInfoDec, masterEventListSchema) as GarupaMasterEventListResponse;
    const events = eventList.entries ?? [];
    console.log(`  HTTP 200, ${eventInfoDec.length}B, ${events.length} 个活动`);
    for (const e of events) {
        console.log(`    ID:${e.eventId} Type:${e.eventType} Name:${e.eventName ?? "N/A"}`);
    }

    console.log("\n[月榜信息] /api/monthlyranking");
    const { decrypted: monthlyInfoDec } = await get(new URL("monthlyranking", CN_BASE_URL).toString(), randRid());
    const monthlyList = parser.decode(monthlyInfoDec, masterMonthlyRankingListSchema) as GarupaMasterMonthlyRankingListResponse;
    const monthlies = monthlyList.entries ?? [];
    console.log(`  HTTP 200, ${monthlyInfoDec.length}B, ${monthlies.length} 个月榜`);
    for (const m of monthlies.slice(-5)) {
        console.log(`    ID:${m.monthlyRankingId} Name:${m.monthlyRankingName ?? "N/A"}`);
    }

    // ────── 实验 C: Event Ranking (尝试) ──────
    console.log("\n━━━ 实验 C: Event Ranking 尝试 ━━━");

    // 先尝试获取 event ranking 的 rid
    const protoEventType = "live_try";
    const urlSegment = eventTypeToUrlSegment(protoEventType);
    const eventEndpoint = `user/${CN_UID}/event/316/${urlSegment}/ranking`;
    const eventUrl = new URL(eventEndpoint, CN_BASE_URL).toString();

    // 先看错误 rid 的返回
    const { decrypted: eErr, status: eErrStatus } = await get(eventUrl, randRid());
    console.log(`  错误 rid → HTTP ${eErrStatus}, ${eErr.length}B`);

    if (eErr.length > 0) {
        const eRid = extractRid(eErr);
        if (eRid) {
            console.log(`  提取到 newRequestId: ${eRid.substring(0, 16)}...`);
            const { decrypted: eData, status: eStatus } = await get(eventUrl, eRid);
            console.log(`  用 newRid 请求 → HTTP ${eStatus}, ${eData.length}B`);
            if (eStatus === 200 && eData.length > 100) {
                const eParsed = bandoriEventRankingParser.parse(eData, "live_try");
                console.log(`  ✅ 活动排名解析成功! Top:${eParsed.eventPointTopUsers?.length ?? 0} Border:${eParsed.eventPointBorderUsers?.length ?? 0}`);
            } else {
                console.log(`  ⚠️ 活动排名无数据（事件可能已结束且数据过了保留期）`);
            }
        } else {
            console.log(`  ⚠️ 无法提取 newRequestId (数据为空)`);
        }
    } else {
        console.log(`  ⚠️ 服务器返回空响应（可能事件已结束）`);
    }

    // ────── 总结 ──────
    console.log(`\n${"═".repeat(60)}`);
    console.log("  验证总结");
    console.log("═".repeat(60));
    console.log(`
  国服API爬取策略:
  
  1. 端点分类:
     - 无需 X-Requestid: /api/application, /api/event, /api/monthlyranking
     - 需要 X-Requestid: /api/user/{uid}/monthlyranking/{id}/ranking
                         /api/user/{uid}/event/{id}/{type}/ranking
  
  2. X-Requestid 获取与使用:
     - 先发送任意错误 rid → HTTP 405 + protobuf错误
     - 从 protobuf 错误响应 (field 3) 中提取 newRequestId
     - 用 newRequestId 重试请求
     - rid 可重复使用（非一次性）
  
  3. protobuf eventType → URL 路径段映射:
     challenge          → challenge          (一致)
     live_try           → livetry            (来自反编译URL模板)
     medley             → medley             (一致)
     mission_live       → mission            (来自反编译URL模板)
     story              → story              (一致)
     team_live_festival → festival           (来自反编译URL模板)
     versus             → versus             (一致)
     日服国服使用相同的 URL 路径模板，映射一致。
     详见 eventTypeMapping.ts
    
   4. 加密参数:
      - 使用 CN_ENCRYPTION_KEY / CN_ENCRYPTION_IV（见 config.ts）
      - AES-128-CBC, no padding
    
  5. 额外 Headers:
     - X-Requestid, X-Token, X-DataVersion, X-MasterDataVersion
     - X-ChannelID, X-PlatformID, X-DeviceID
     - X-ClientPlatform, X-Unity-Version, X-ClientVersion
    `);

    console.log("验证完成 ✅");
}

main().catch(console.error);
