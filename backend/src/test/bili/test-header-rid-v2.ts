/**
 * 对比：405 body 提取的 rid vs 200 响应头的 x-requestid
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(b: Buffer): string | null {
    return b.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

async function getRidFromError(): Promise<string> {
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(randRid()) });
    const rid = extractRid(decryptCn(Buffer.from(await res.arrayBuffer())));
    if (!rid) throw new Error("No rid from error");
    return rid;
}

async function main() {
    // 1. 获取初始 rid
    const rid0 = await getRidFromError();
    console.log(`初始 rid (405 body): ${rid0}`);

    // 2. 用 rid0 成功请求一次，拿到响应头的 x-requestid
    console.log("\n2. 用 rid0 请求:");
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid0) });
    const headerRid = res.headers.get("x-requestid");
    console.log(`   HTTP ${res.status}, x-requestid(header): ${headerRid}`);

    // 3. 成功请求后，用错误rid获取服务端当前期望的 rid
    const ridAfter = await getRidFromError();
    console.log(`\n3. 消费后 405 body 返回的 rid: ${ridAfter}`);
    console.log(`   与 header 相同: ${headerRid === ridAfter}`);

    // 4. 用 405 body 的 rid 请求，拿到响应头
    console.log("\n4. 用 405 body 的 rid 请求:");
    const res2 = await fetch(url, { headers: buildCnRankingHeaders(ridAfter) });
    const headerRid2 = res2.headers.get("x-requestid");
    console.log(`   HTTP ${res2.status}, x-requestid(header): ${headerRid2}`);
    console.log(`   与 ridAfter 相同: ${headerRid2 === ridAfter}`);

    // 5. 再用 headerRid 请求
    if (headerRid && headerRid !== ridAfter) {
        console.log("\n5. 用原始 header rid 请求:");
        const res3 = await fetch(url, { headers: buildCnRankingHeaders(headerRid) });
        console.log(`   HTTP ${res3.status}`);
        if (res3.status === 405) {
            const errRid = extractRid(decryptCn(Buffer.from(await res3.arrayBuffer())));
            console.log(`   405 body newRequestId: ${errRid}`);
            console.log(`   与 ridAfter 相同: ${errRid === ridAfter}`);
        }
    }

    console.log("\n=== 结论 ===");
    if (headerRid === ridAfter) {
        console.log("✅ 响应头 x-requestid == 消费后 405 body 的 newRequestId");
        console.log("   服务端返回的 x-requestid 就是刚消费完的旧rid，不是下一个");
    }
}

main().catch(console.error);
