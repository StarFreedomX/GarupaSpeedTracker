/**
 * 验证：响应头 x-requestid 能不能直接用于下一次请求
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
    // Step 1: 通过错误请求获取初始 rid
    console.log("Step 1: 获取初始 rid");
    const errUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const errRes = await fetch(errUrl, { headers: buildCnRankingHeaders(randRid()) });
    const rid1 = extractRid(decryptCn(Buffer.from(await errRes.arrayBuffer())));
    console.log(`  初始 rid: ${rid1}`);

    // Step 2: 用 rid1 请求 monthly 18，检查响应头的 x-requestid
    console.log("\nStep 2: 用 rid1 请求 monthly 18");
    const url18 = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res1 = await fetch(url18, { headers: buildCnRankingHeaders(rid1!) });
    const rid2 = res1.headers.get("x-requestid");
    console.log(`  HTTP ${res1.status}, 响应头 x-requestid: ${rid2}`);
    const data1Size = Buffer.from(await res1.arrayBuffer()).length;

    // Step 3: 用响应头的 rid2 请求 monthly 18，拿到数据
    console.log("\nStep 3: 用响应头的 rid2 请求 monthly 18");
    const res2 = await fetch(url18, { headers: buildCnRankingHeaders(rid2!) });
    console.log(`  HTTP ${res2.status}`);
    const data2Size = Buffer.from(await res2.arrayBuffer()).length;
    console.log(`  data size: ${data2Size}B`);

    // Step 4: 再用 rid2 请求 monthly 1（不同 monthlyId），看是否触发缓存
    console.log("\nStep 4: 用 rid2 请求 monthly 1（跨 monthlyId）");
    const url1 = new URL(`user/${CN_UID}/monthlyranking/1/ranking`, CN_BASE_URL).toString();
    const res3 = await fetch(url1, { headers: buildCnRankingHeaders(rid2!) });
    console.log(`  HTTP ${res3.status}`);
    const data3Size = Buffer.from(await res3.arrayBuffer()).length;
    const rid3 = res3.headers.get("x-requestid");
    console.log(`  data size: ${data3Size}B, 下一次 rid: ${rid3}`);
    console.log(`  与 data2 大小相同: ${data2Size === data3Size}`);

    // Step 5: 用 rid2 再请求 monthly 18，看是否还是原来的数据
    console.log("\nStep 5: 再用 rid2 请求 monthly 18（同一个 rid 用两次不同 endpoint）");
    const res4 = await fetch(url18, { headers: buildCnRankingHeaders(rid2!) });
    console.log(`  HTTP ${res4.status}, data size: ${Buffer.from(await res4.arrayBuffer()).length}B`);
    const rid4 = res4.headers.get("x-requestid");
    console.log(`  响应头 x-requestid: ${rid4}`);
    console.log(`  rid4 === rid3: ${rid4 === rid3}`);

    console.log("\n=== 结论 ===");
    const ok = rid2 && rid3 && rid2 !== rid3;
    console.log(ok ? "✅ 响应头 x-requestid 可用，每次成功请求后服务端推进到下一个" : "❌ 有问题");
}

main().catch(console.error);
