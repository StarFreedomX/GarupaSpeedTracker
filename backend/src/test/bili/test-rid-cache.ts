/**
 * 验证：同一 rid 请求不同 monthlyId 是否触发服务端缓存
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, decryptCn } from "./config";

function readVarint(b: Buffer, o: number): { value: number; offset: number } {
    let v = 0,
        s = 0;
    while (o < b.length) {
        const by = b[o++];
        v += (by & 0x7f) * 2 ** s;
        if ((by & 0x80) === 0) return { value: v, offset: o };
        s += 7;
    }
    throw new Error("eof");
}

function randRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function extractRid(b: Buffer): string | null {
    return b.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

function getTier1Point(data: Buffer): number {
    let off = 0;
    while (off < data.length) {
        const k = readVarint(data, off);
        off = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 2) {
            const l = readVarint(data, off);
            off = l.offset;
            const d = data.subarray(off, off + l.value);
            off += l.value;
            if (f === 3) {
                let io = 0;
                while (io < d.length) {
                    const ik = readVarint(d, io);
                    io = ik.offset;
                    const iff = ik.value >> 3,
                        iw = ik.value & 7;
                    if (iw === 2 && iff === 1) {
                        const il = readVarint(d, io);
                        io = il.offset;
                        const u = d.subarray(io, io + il.value);
                        io += il.value;
                        let uo = 0,
                            pt = 0,
                            rk = 0;
                        while (uo < u.length) {
                            const uk = readVarint(u, uo);
                            uo = uk.offset;
                            const uf = uk.value >> 3,
                                uw = uk.value & 7;
                            if (uw === 0) {
                                const uv = readVarint(u, uo);
                                uo = uv.offset;
                                if (uf === 5) rk = uv.value;
                                if (uf === 6) pt = uv.value;
                            } else if (uw === 2) {
                                const ul = readVarint(u, uo);
                                uo = ul.offset;
                                uo += ul.value;
                            } else {
                                break;
                            }
                        }
                        if (rk === 1) return pt;
                    } else if (iw === 0) {
                        io = readVarint(d, io).offset;
                    } else {
                        break;
                    }
                }
            }
        } else if (w === 0) {
            off = readVarint(data, off).offset;
        } else {
            off += 1;
        }
    }
    return -1;
}

async function fetchDec(path: string, rid: string) {
    const url = new URL(path, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    return { dec: decryptCn(Buffer.from(await res.arrayBuffer())), status: res.status };
}

async function getFreshRid(path: string): Promise<string> {
    const { dec } = await fetchDec(path, randRid());
    const rid = extractRid(dec);
    if (!rid) throw new Error("No newRequestId");
    return rid;
}

async function main() {
    // 实验1: 同一个 rid 请求 monthly 1 和 18
    console.log("=== 实验1: 同一 rid 请求 monthly 1 和 18 ===");
    const rid1 = await getFreshRid("user/1009296935/monthlyranking/1/ranking");
    console.log(`rid: ${rid1.substring(0, 16)}...`);

    const r1 = await fetchDec("user/1009296935/monthlyranking/1/ranking", rid1);
    const r18a = await fetchDec("user/1009296935/monthlyranking/18/ranking", rid1);

    console.log(`monthly 1: HTTP ${r1.status}, ${r1.dec.length}B, tier1 pt=${getTier1Point(r1.dec)}`);
    console.log(`monthly 18 (同rid): HTTP ${r18a.status}, ${r18a.dec.length}B, tier1 pt=${getTier1Point(r18a.dec)}`);
    console.log(`data identical: ${r1.dec.equals(r18a.dec)}`);
    console.log(`结论: ${r1.dec.equals(r18a.dec) ? "❌ 同一rid触发服务端缓存！" : "✅ 不同数据"}`);

    // 实验2: 不同 rid 分别请求
    console.log("\n=== 实验2: 各自用独立 rid ===");
    const rid18 = await getFreshRid("user/1009296935/monthlyranking/18/ranking");
    console.log(`monthly 18 独立 rid: ${rid18.substring(0, 16)}...`);
    const r18b = await fetchDec("user/1009296935/monthlyranking/18/ranking", rid18);
    console.log(`monthly 18 (独立rid): HTTP ${r18b.status}, ${r18b.dec.length}B, tier1 pt=${getTier1Point(r18b.dec)}`);
    console.log(`r18a vs r18b identical: ${r18a.dec.equals(r18b.dec)}`);

    // 实验3: 连续两个请求都用新 rid
    console.log("\n=== 实验3: 每个请求都获取新 rid ===");
    const r1b = await fetchDec("user/1009296935/monthlyranking/1/ranking", await getFreshRid("user/1009296935/monthlyranking/1/ranking"));
    const r18c = await fetchDec("user/1009296935/monthlyranking/18/ranking", await getFreshRid("user/1009296935/monthlyranking/18/ranking"));
    console.log(`monthly 1: HTTP ${r1b.status}, tier1 pt=${getTier1Point(r1b.dec)}`);
    console.log(`monthly 18: HTTP ${r18c.status}, tier1 pt=${getTier1Point(r18c.dec)}`);
    console.log(`data identical: ${r1b.dec.equals(r18c.dec)}`);

    console.log("\n=== 完成 ===");
}

main().catch(console.error);
