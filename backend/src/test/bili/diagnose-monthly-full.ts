/**
 * 深度诊断：国服月榜完整 protobuf 结构
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0,
        shift = 0,
        cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
    }
    throw new Error("unexpected end");
}

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(buf: Buffer): string | null {
    const m = buf.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i);
    return m?.[1] ?? null;
}

function probe(buf: Buffer, depth: number = 0, maxDepth: number = 4): string[] {
    const lines: string[] = [];
    let off = 0;
    const prefix = "  ".repeat(depth);
    while (off < buf.length) {
        const k = readVarint(buf, off);
        off = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 0) {
            const v = readVarint(buf, off);
            off = v.offset;
            lines.push(`${prefix}field=${f} varint=${v.value}`);
        } else if (w === 2) {
            const l = readVarint(buf, off);
            off = l.offset;
            const inner = buf.subarray(off, off + l.value);
            off += l.value;
            const str = inner.toString("utf8");
            const printable = str.replace(/[^\x20-\x7e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, ".");
            if (/^[\x20-\x7e\u4e00-\u9fff]*$/.test(str.substring(0, 20)) && !str.includes("\x00")) {
                lines.push(`${prefix}field=${f} string(${l.value}) "${printable.substring(0, 40)}"`);
            } else if (depth < maxDepth) {
                lines.push(`${prefix}field=${f} message(${l.value}B)`);
                lines.push(...probe(inner, depth + 1, maxDepth));
            } else {
                lines.push(`${prefix}field=${f} bytes(${l.value})`);
            }
        } else if (w === 1) {
            off += 8;
        } else if (w === 5) {
            off += 4;
        } else {
            off += 1;
        }
    }
    return lines;
}

async function main() {
    // 获取有效 rid
    const errUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const errRes = await fetch(errUrl, { headers: buildCnRankingHeaders(randRid()) });
    const errDec = decryptCn(Buffer.from(await errRes.arrayBuffer()));
    const rid = extractRid(errDec);
    if (!rid) {
        console.log("无法获取 rid");
        return;
    }

    // 用有效 rid 请求
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const decrypted = decryptCn(Buffer.from(await res.arrayBuffer()));
    console.log(`HTTP ${res.status}, ${decrypted.length}B\n`);

    // 完整探测（深度3）
    console.log("=== 完整 protobuf 结构（深度3）===");
    const lines = probe(decrypted, 0, 3);
    for (const l of lines.slice(0, 80)) console.log(l);
    if (lines.length > 80) console.log(`... (${lines.length - 80} more lines)`);
}

main().catch(console.error);
