/**
 * 对比 CN 月榜 monthlyId 1 vs 18 的返回数据
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

function dumpBorder(data: Buffer, label: string) {
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
                console.log(`\n${label}: field=3, ${l.value}B`);
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
                        console.log(`  tier=${rk} pt=${pt}`);
                    } else if (iw === 0) {
                        io = readVarint(d, io).offset;
                    } else {
                        break;
                    }
                }
                return;
            }
        } else if (w === 0) {
            off = readVarint(data, off).offset;
        } else {
            off += 1;
        }
    }
}

async function main() {
    const rid = extractRid(
        decryptCn(
            Buffer.from(
                await (
                    await fetch(new URL(`user/${CN_UID}/monthlyranking/1/ranking`, CN_BASE_URL).toString(), { headers: buildCnRankingHeaders(randRid()) })
                ).arrayBuffer(),
            ),
        ),
    );

    if (!rid) {
        console.log("No rid");
        return;
    }

    const headers = buildCnRankingHeaders(rid);

    // Fetch both
    const [r1, r18] = await Promise.all([
        fetch(new URL(`user/${CN_UID}/monthlyranking/1/ranking`, CN_BASE_URL).toString(), { headers }),
        fetch(new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString(), { headers }),
    ]);

    const d1 = decryptCn(Buffer.from(await r1.arrayBuffer()));
    const d18 = decryptCn(Buffer.from(await r18.arrayBuffer()));

    console.log(`monthlyId=1: HTTP ${r1.status}, ${d1.length}B`);
    console.log(`monthlyId=18: HTTP ${r18.status}, ${d18.length}B`);
    console.log(`identical: ${d1.equals(d18)}`);

    dumpBorder(d1, "monthly 1 border");
    dumpBorder(d18, "monthly 18 border");
}

main().catch(console.error);
