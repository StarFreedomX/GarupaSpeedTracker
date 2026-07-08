/**
 * 检查成功响应头中是否携带了下一个 X-Requestid
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(b: Buffer): string | null {
    return b.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

async function main() {
    // 获取当前有效 rid
    const errUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const errRes = await fetch(errUrl, { headers: buildCnRankingHeaders(randRid()) });
    const rid = extractRid(decryptCn(Buffer.from(await errRes.arrayBuffer())));
    console.log(`当前有效 rid: ${rid}\n`);
    if (!rid) return;

    // 用正确 rid 请求，检查响应头
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    console.log(`HTTP ${res.status}`);
    console.log(`\n=== 所有响应头 ===`);
    res.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));

    // 也检查 application 的响应头
    console.log(`\n=== application 响应头 ===`);
    const appUrl = new URL("application", CN_BASE_URL).toString();
    const appRes = await fetch(appUrl, { headers: buildCnRankingHeaders(rid) });
    console.log(`HTTP ${appRes.status}`);
    appRes.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));

    // 检查 event info 响应头
    console.log(`\n=== event info 响应头 ===`);
    const evtUrl = new URL("event", CN_BASE_URL).toString();
    const evtRes = await fetch(evtUrl, { headers: buildCnRankingHeaders(rid) });
    console.log(`HTTP ${evtRes.status}`);
    evtRes.headers.forEach((v, k) => console.log(`  ${k}: ${v}`));
}

main().catch(console.error);
