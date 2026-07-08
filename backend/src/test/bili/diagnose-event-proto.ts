/**
 * 快速诊断：检查国服 event ranking 端点的 protobuf 错误响应结构
 * 用于调试 X-Requestid 错误时的 protobuf 字段分布
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

// 刻意错误的 rid，用于触发错误响应
const BAD_RID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";

function decrypt(encrypted: Buffer): Buffer {
    return decryptCn(encrypted);
}

function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
        if (shift > 56) throw new Error("varint too large");
    }
    throw new Error("unexpected end");
}

async function main() {
    const endpoint = process.argv[2] ?? `user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`;
    const url = new URL(endpoint, CN_BASE_URL).toString();

    console.log("Fetching:", url);
    const response = await fetch(url, { headers: buildCnRankingHeaders(BAD_RID) });
    console.log("HTTP Status:", response.status);
    console.log("Headers:", JSON.stringify(Object.fromEntries(response.headers)));

    const encrypted = Buffer.from(await response.arrayBuffer());
    console.log("Encrypted size:", encrypted.length, "bytes");
    console.log("Encrypted first 16 bytes:", encrypted.subarray(0, 16).toString("hex"));

    if (encrypted.length === 0) {
        console.log("⚠️ 空响应!");
        return;
    }

    const decrypted = decrypt(encrypted);
    console.log("Decrypted size:", decrypted.length, "bytes");
    console.log("Decrypted full hex:", decrypted.toString("hex"));
    console.log("Decrypted as text:", decrypted.toString("utf8"));

    // 手动解析 protobuf
    console.log("\n--- Manual Proto Parse ---");
    let offset = 0;
    while (offset < decrypted.length) {
        const key = readVarint(decrypted, offset);
        offset = key.offset;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 0) {
            const val = readVarint(decrypted, offset);
            offset = val.offset;
            console.log(`  field=${field}, wireType=${wireType} (varint), value=${val.value}`);
        } else if (wireType === 2) {
            const len = readVarint(decrypted, offset);
            offset = len.offset;
            const data = decrypted.subarray(offset, offset + len.value);
            offset += len.value;
            const text = data.toString("utf8");
            console.log(`  field=${field}, wireType=${wireType} (bytes), len=${len.value}, text="${text.substring(0, 300)}"`);
        } else {
            console.log(`  field=${field}, wireType=${wireType} (unknown), stopping`);
            break;
        }
    }
}

main().catch(console.error);
