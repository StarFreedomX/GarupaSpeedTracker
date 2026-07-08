/**
 * 探索：X-Requestid 的生成规律
 *
 * 测试：
 * 1. 连续多次错误 rid，看 newRequestId 是否每次都相同 → 如果相同，是固定 token
 * 2. 多次成功请求后，newRequestId 是否有规律（是否可预测）
 * 3. newRequestId 之间是否存在数学关系
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(b: Buffer): string | null {
    return b.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

async function getRid(): Promise<{ rid: string; raw: Buffer }> {
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(randRid()) });
    const dec = decryptCn(Buffer.from(await res.arrayBuffer()));
    const rid = extractRid(dec);
    if (!rid) throw new Error("No rid");
    return { rid, raw: dec };
}

async function fetchOk(rid: string): Promise<boolean> {
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    return res.status === 200;
}

async function main() {
    // 1. 连续多次错误 rid，看 newRequestId 是否固定
    console.log("1. 连续 3 次错误 rid，newRequestId 是否固定:");
    const rids: string[] = [];
    for (let i = 0; i < 3; i++) {
        const { rid } = await getRid();
        rids.push(rid);
        console.log(`  #${i + 1}: ${rid}`);
    }
    console.log(`  全部相同: ${rids[0] === rids[1] && rids[1] === rids[2]}`);

    // 2. 用当前 rid 成功请求 → 再获取下一个 rid → 看规律
    console.log("\n2. 成功请求后 rid 是否可预测:");
    const { rid: r0 } = await getRid();
    console.log(`  rid0: ${r0}`);

    // 用 r0 做一次成功请求
    const ok0 = await fetchOk(r0);
    console.log(`  消费 rid0: HTTP ${ok0 ? 200 : "fail"}`);

    // 消费后获取新 rid
    const { rid: r1 } = await getRid();
    console.log(`  rid1: ${r1}`);
    console.log(`  rid0 == rid1: ${r0 === r1}`);

    // 再消费 rid1，获取 rid2
    const ok1 = await fetchOk(r1);
    const { rid: r2 } = await getRid();
    console.log(`  rid2: ${r2}`);

    // 3. 检查 rid 之间的数学关系
    console.log("\n3. 数学关系分析:");
    const asBigInt = (hex: string) => BigInt(`0x${hex}`);
    try {
        console.log(`  rid0 bigint: ${asBigInt(r0)}`);
        console.log(`  rid1 bigint: ${asBigInt(r1)}`);
        console.log(`  rid2 bigint: ${asBigInt(r2)}`);
        console.log(`  r1-r0: ${asBigInt(r1) - asBigInt(r0)}`);
        console.log(`  r2-r1: ${asBigInt(r2) - asBigInt(r1)}`);
    } catch {
        console.log("  (bigint overflow)");
    }

    // 4. 是否 MD5 模式？检查单个字符变化时 newRequestId 是否完全不同
    console.log("\n4. 相近错误 rid 是否返回相同 newRequestId:");
    const baseRid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0";
    for (const suffix of ["0", "1", "2", "f"]) {
        const testRid = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + suffix;
        const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
        const res = await fetch(url, { headers: buildCnRankingHeaders(testRid) });
        const dec = decryptCn(Buffer.from(await res.arrayBuffer()));
        const r = extractRid(dec);
        console.log(`  ${testRid.substring(28)} → newRid: ${r?.substring(0, 16) ?? "无"}...`);
    }

    console.log("\n=== 结论 ===");
    console.log("rid 看起来是服务端维护的全局 token，每次成功请求后服务端生成新的随机 token。");
    console.log("无法从客户端预测。'错误rid→提取new→重试' 是唯一可行的方式。");
}

main().catch(console.error);
