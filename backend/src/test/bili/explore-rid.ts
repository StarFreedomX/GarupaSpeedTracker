/**
 * 探索：获取 fresh X-Requestid 的各种方式
 *
 * 测试场景：
 * A. 向同一个 endpoint 发两次错误 rid，返回的 newRequestId 是否相同？
 * B. 向不同 endpoint 发错误 rid，返回的 newRequestId 是否相同？
 * C. 成功请求后立即再发错误 rid，newRequestId 是否会变？
 * D. 同一个 newRequestId 能用几次？（单 endpoint 内）
 * E. 用 application 端点（无 rid 校验）能否获取 rid？
 */
import { Buffer } from "node:buffer";
import { buildCnInfoHeaders, buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(b: Buffer): string | null {
    return b.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

async function fetchDec(path: string, rid: string) {
    const url = new URL(path, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    return { dec: decryptCn(Buffer.from(await res.arrayBuffer())), status: res.status };
}

async function getRid(path: string): Promise<string> {
    const { dec } = await fetchDec(path, randRid());
    const rid = extractRid(dec);
    if (!rid) throw new Error(`No newRequestId from ${path}. status=${(await fetchDec(path, randRid())).status}, len=${dec.length}`);
    return rid;
}

async function main() {
    const m1ep = `user/${CN_UID}/monthlyranking/1/ranking`;
    const m18ep = `user/${CN_UID}/monthlyranking/18/ranking`;
    const evtEp = `user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`;

    // ── A: 同一 endpoint 连续两次错误 rid，newRequestId 是否相同？ ──
    console.log("A. 同一 endpoint 连续两次错误 rid:");
    const rA1 = await getRid(m1ep);
    const rA2 = await getRid(m1ep);
    console.log(`  rid1: ${rA1}\n  rid2: ${rA2}\n  same: ${rA1 === rA2}`);
    // 结论：如果相同，说明未消费无效；如果不同，说明每次错误rid都生成新rid

    // ── B: 不同 endpoint 的 rid 是否孤立？ ──
    console.log("\nB. 不同 endpoint 获取的 rid:");
    const rBm1 = await getRid(m1ep);
    const rBm18 = await getRid(m18ep);
    const rBevt = await getRid(evtEp);
    console.log(`  m1:  ${rBm1}\n  m18: ${rBm18}\n  evt: ${rBevt}`);
    console.log(`  all same: ${rBm1 === rBm18 && rBm18 === rBevt}`);

    // ── C: 成功请求后，再发错误 rid，rid 是否刷新？ ──
    console.log("\nC. 成功消费后 rid 是否被刷新:");
    const rCbase = await getRid(m18ep);
    // 先用正确 rid 获取数据
    const { status: ok } = await fetchDec(m18ep, rCbase);
    console.log(`  正确rid请求: HTTP ${ok}`);
    // 再发错误rid
    const rCafter = await getRid(m18ep);
    console.log(`  消费前rid: ${rCbase}\n  消费后rid: ${rCafter}\n  same: ${rCbase === rCafter}`);

    // ── D: 同一个 rid 能对同一 endpoint 用几次？ ──
    console.log("\nD. 同一 rid 对同一 endpoint 复用:");
    const rD = await getRid(m18ep);
    const d1 = await fetchDec(m18ep, rD);
    const d2 = await fetchDec(m18ep, rD);
    const d3 = await fetchDec(m18ep, rD);
    console.log(`  #1: HTTP ${d1.status}, ${d1.dec.length}B`);
    console.log(`  #2: HTTP ${d2.status}, ${d2.dec.length}B (same: ${d1.dec.equals(d2.dec)})`);
    console.log(`  #3: HTTP ${d3.status}, ${d3.dec.length}B (same: ${d1.dec.equals(d3.dec)})`);

    // ── E: application 端点能否触发 rid 返回？ ──
    console.log("\nE. application 端点能否获取 rid:");
    const appUrl = new URL("application", CN_BASE_URL).toString();
    // 不带 rid
    const app1 = await fetch(appUrl, { headers: buildCnInfoHeaders() });
    console.log(`  无rid: HTTP ${app1.status}, ${Buffer.from(await app1.arrayBuffer()).length}B`);
    // 带错误 rid
    const app2 = await fetch(appUrl, { headers: buildCnRankingHeaders(randRid()) });
    const app2Dec = decryptCn(Buffer.from(await app2.arrayBuffer()));
    console.log(`  错误rid: HTTP ${app2.status}, ${app2Dec.length}B`);
    const appRid = extractRid(app2Dec);
    console.log(`  提取到 rid: ${appRid ?? "无"}`);

    // ── F: 错误rid被修正后，直接用修正的rid请求别的endpoint ──
    console.log("\nF. 从 m18 获取的 rid 用于 m1，再反过来:");
    const rF = await getRid(m18ep);
    const f1 = await fetchDec(m1ep, rF);
    const f2 = await fetchDec(m18ep, rF);
    const f1Rid = extractRid(f1.dec);
    const f2Rid = extractRid(f2.dec);
    console.log(`  rid=${rF.substring(0, 16)}...`);
    console.log(`  m1: HTTP ${f1.status}, ${f1.dec.length}B, newRid=${f1Rid?.substring(0, 16) ?? "无"}...`);
    console.log(`  m18: HTTP ${f2.status}, ${f2.dec.length}B, newRid=${f2Rid?.substring(0, 16) ?? "无"}...`);
    console.log(`  data identical: ${f1.dec.equals(f2.dec)}`);

    console.log("\n=== 探索完成 ===");
}

main().catch(console.error);
