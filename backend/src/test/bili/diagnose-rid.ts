/**
 * 诊断：测试不同 X-Requestid 值对 event ranking 和 monthly ranking 的影响
 * 包括不带 rid 的情况、各种格式的 rid
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function decrypt(encrypted: Buffer): Buffer {
    return decryptCn(encrypted);
}

async function main() {
    const eventType = process.argv[2] ?? "event";
    const endpoint =
        eventType === "monthly" ? `user/${CN_UID}/monthlyranking/18/ranking` : `user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`;

    console.log(`=== 诊断 ${eventType} ranking ===`);
    console.log(`Endpoint: ${endpoint}\n`);

    const tests = [
        { label: "随机 rid", rid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb" },
        { label: "全0 rid", rid: "00000000000000000000000000000000" },
        { label: "全f rid", rid: "ffffffffffffffffffffffffffffffff" },
        { label: "随机2", rid: Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("") },
    ];

    for (const t of tests) {
        console.log(`--- ${t.label}: ${t.rid} ---`);
        const url = new URL(endpoint, CN_BASE_URL).toString();

        try {
            const response = await fetch(url, { headers: buildCnRankingHeaders(t.rid) });
            console.log(`HTTP Status: ${response.status}`);

            const raw = Buffer.from(await response.arrayBuffer());
            console.log(`Raw size: ${raw.length}B`);
            console.log(`Raw first 32 hex: ${raw.subarray(0, 32).toString("hex")}`);

            if (raw.length === 0) {
                console.log(`⚠️ 空响应!`);
                continue;
            }

            const dec = decrypt(raw);
            console.log(`Decrypted size: ${dec.length}B`);

            const text = dec.toString("utf8");
            const printable = text.replace(/[^\x20-\x7e]/g, ".");
            console.log(`Text: ${printable.substring(0, 300)}`);

            if (printable.includes("newRequestId")) {
                const match = printable.match(/\[newRequestId:([a-f0-9]+)\]/i);
                console.log(`✅ newRequestId: ${match?.[1]}`);
            }
        } catch (err) {
            console.error(`错误: ${(err as Error).message}`);
        }
    }
}

main().catch(console.error);
