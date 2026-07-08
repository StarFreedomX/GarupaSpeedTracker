/**
 * 探活动榜 protobuf 顶层字段
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

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

async function main() {
    const errUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const rid = extractRid(decryptCn(Buffer.from(await (await fetch(errUrl, { headers: buildCnRankingHeaders(randRid()) })).arrayBuffer())));
    if (!rid) {
        console.log("No rid");
        return;
    }

    const url = new URL(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const dec = decryptCn(Buffer.from(await res.arrayBuffer()));
    console.log(`HTTP ${res.status}, ${dec.length}B\n`);
    console.log("=== 活动榜 顶层字段 ===");
    let off = 0;
    while (off < dec.length) {
        const k = readVarint(dec, off);
        off = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 2) {
            const l = readVarint(dec, off);
            off = l.offset;
            console.log(`field=${f} message(${l.value}B)`);
            off += l.value;
        } else if (w === 0) {
            const v = readVarint(dec, off);
            off = v.offset;
            console.log(`field=${f} varint=${v.value}`);
        } else {
            off += 1;
        }
    }

    // 用现有 parser
    console.log("\n=== 用 parser 解析 ===");
    const { bandoriEventRankingParser } = await import("@/parsers/GarupaEventRankingParser");
    const parsed = bandoriEventRankingParser.parse(dec, "live_try");
    console.log(`top: ${parsed.eventPointTopUsers?.length ?? 0}, border: ${parsed.eventPointBorderUsers?.length ?? 0}`);
    if (parsed.eventPointTopUsers?.length) {
        for (const u of parsed.eventPointTopUsers.slice(0, 3)) {
            console.log(`  #${u.tier} ${u.name} pt:${u.point}`);
        }
    }

    // 手动提取 field 2 (topUsers) 的第一个用户
    console.log("\n=== 手动提取 field=2 的第一个用户 ===");
    off = 0;
    while (off < dec.length) {
        const k = readVarint(dec, off);
        off = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 2) {
            const l = readVarint(dec, off);
            off = l.offset;
            const d = dec.subarray(off, off + l.value);
            off += l.value;
            if (f === 2) {
                // live_try schema: field 2 = topUsers? No wait...
                // Actually, let me check: the schema says {1: topUsers, 2: eventPointBorderUsers}
                // But the parsed output says Top:10 from ???
                // Let me check both fields
                let io = 0,
                    count = 0;
                while (io < d.length && count < 3) {
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
                            nm = "",
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
                                if (uf === 1) nm = u.subarray(uo, uo + ul.value).toString("utf8");
                                uo += ul.value;
                            } else {
                                break;
                            }
                        }
                        console.log(`  #${rk} ${nm} pt:${pt}`);
                        count++;
                    } else if (iw === 0) {
                        io = readVarint(d, io).offset;
                    } else {
                        break;
                    }
                }
            }
        } else if (w === 0) {
            off = readVarint(dec, off).offset;
        } else {
            off += 1;
        }
    }
}

main().catch(console.error);
