/**
 * 检查 CN 月榜 field 3 (eventPointBorderUsers) 的实际内容
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";

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

    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const dec = decryptCn(Buffer.from(await (await fetch(url, { headers: buildCnRankingHeaders(rid) })).arrayBuffer()));

    // 找 field 3 (eventPointBorderUsers)
    let off = 0;
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
            if (f === 3) {
                // field 3 = eventPointBorderUsers
                console.log(`field=3 eventPointBorderUsers (${l.value}B)`);
                // 遍历 border users
                let io = 0,
                    count = 0;
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
                        console.log(`  tier=${rk} pt=${pt} name="${nm}"`);
                        count++;
                    } else if (iw === 0) {
                        io = readVarint(d, io).offset;
                    } else {
                        break;
                    }
                }
                console.log(`  total: ${count} border entries`);
                break;
            }
        } else if (w === 0) {
            off = readVarint(dec, off).offset;
        } else {
            off += 1;
        }
    }
}

main().catch(console.error);
