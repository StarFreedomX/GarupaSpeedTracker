/**
 * 对比：月榜 top vs 活动榜 top 的 point 值
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

function extractTopUsers(buf: Buffer, fieldNum: number) {
    let off = 0;
    while (off < buf.length) {
        const k = readVarint(buf, off);
        off = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 2) {
            const l = readVarint(buf, off);
            off = l.offset;
            const d = buf.subarray(off, off + l.value);
            off += l.value;
            if (f === fieldNum) {
                const users: { name: string; rank: number; point: number; uid: number }[] = [];
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
                            name = "",
                            point = 0,
                            uid = 0,
                            rank = 0;
                        while (uo < u.length) {
                            const uk = readVarint(u, uo);
                            uo = uk.offset;
                            const uf = uk.value >> 3,
                                uw = uk.value & 7;
                            if (uw === 0) {
                                const uv = readVarint(u, uo);
                                uo = uv.offset;
                                if (uf === 5) rank = uv.value;
                                else if (uf === 6) point = uv.value;
                                else if (uf === 7) uid = uv.value;
                            } else if (uw === 2) {
                                const ul = readVarint(u, uo);
                                uo = ul.offset;
                                const ud = u.subarray(uo, uo + ul.value);
                                uo += ul.value;
                                if (uf === 1) name = ud.toString("utf8");
                            } else {
                                break;
                            }
                        }
                        users.push({ name, rank, point, uid });
                        if (rank >= 5) break;
                    } else if (iw === 0) {
                        io = readVarint(d, io).offset;
                    } else {
                        break;
                    }
                }
                return users;
            }
        } else if (w === 0) {
            off = readVarint(buf, off).offset;
        } else {
            break;
        }
    }
    return [];
}

async function fetchDec(path: string, rid: string): Promise<Buffer | null> {
    const url = new URL(path, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    if (!res.ok) {
        console.log(`  HTTP ${res.status}`);
        return null;
    }
    return decryptCn(Buffer.from(await res.arrayBuffer()));
}

async function main() {
    // 获取 rid
    const errUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const rid = extractRid(decryptCn(Buffer.from(await (await fetch(errUrl, { headers: buildCnRankingHeaders(randRid()) })).arrayBuffer())));
    if (!rid) {
        console.log("No rid");
        return;
    }
    console.log(`rid: ${rid.substring(0, 16)}...\n`);

    // 月榜 top (field 2)
    console.log("=== 月榜 top (field=2) ===");
    const mBuf = await fetchDec(`user/${CN_UID}/monthlyranking/18/ranking`, rid);
    if (mBuf) for (const u of extractTopUsers(mBuf, 2)) console.log(`  #${u.rank} ${u.name} point:${u.point}`);

    // 活动榜 top (live_try field=1)
    console.log("\n=== 活动榜 top (event 316 live_try, field=1) ===");
    const eBuf = await fetchDec(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`, rid);
    if (eBuf) for (const u of extractTopUsers(eBuf, 1)) console.log(`  #${u.rank} ${u.name} point:${u.point}`);

    console.log("\nDone");
}

main().catch(console.error);
