/**
 * 诊断：国服月榜排名 protobuf 字段分布
 * 验证 rankingUserSchema 的 field 6 (point) 是否是正确的位置
 */
import { Buffer } from "node:buffer";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

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

    // 用有效 rid 请求数据
    const url = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const res = await fetch(url, { headers: buildCnRankingHeaders(rid) });
    const decrypted = decryptCn(Buffer.from(await res.arrayBuffer()));
    console.log(`HTTP ${res.status}, ${decrypted.length}B\n`);

    // 手动解析顶层字段
    let offset = 0;
    console.log("=== 顶层字段 ===");
    while (offset < decrypted.length) {
        const k = readVarint(decrypted, offset);
        offset = k.offset;
        const f = k.value >> 3,
            w = k.value & 7;
        if (w === 2) {
            const l = readVarint(decrypted, offset);
            offset = l.offset;
            console.log(`field=${f}, len=${l.value}`);
            offset += l.value;
        } else if (w === 0) {
            const v = readVarint(decrypted, offset);
            offset = v.offset;
            console.log(`field=${f}, varint=${v.value}`);
        } else {
            break;
        }
    }

    // 找第一个 top user 的字段分布
    console.log("\n=== 第一个月榜Top用户（手动遍历） ===");
    let off2 = 0;
    const firstUserFields: string[] = [];
    while (off2 < decrypted.length) {
        const k2 = readVarint(decrypted, off2);
        off2 = k2.offset;
        const f2 = k2.value >> 3,
            w2 = k2.value & 7;
        if (w2 === 2) {
            const l2 = readVarint(decrypted, off2);
            off2 = l2.offset;
            const data = decrypted.subarray(off2, off2 + l2.value);
            off2 += l2.value;

            if (f2 === 2) {
                // monthlyRankingPointTopUsers container
                let tio = 0;
                while (tio < data.length) {
                    const ik = readVarint(data, tio);
                    tio = ik.offset;
                    const iff = ik.value >> 3,
                        iw = ik.value & 7;
                    if (iw === 2 && iff === 1) {
                        const il = readVarint(data, tio);
                        tio = il.offset;
                        // 第一个用户
                        const userBuf = data.subarray(tio, tio + il.value);
                        tio += il.value;
                        let uo = 0;
                        while (uo < userBuf.length) {
                            const uk = readVarint(userBuf, uo);
                            uo = uk.offset;
                            const uf = uk.value >> 3,
                                uw = uk.value & 7;
                            if (uw === 0) {
                                const uv = readVarint(userBuf, uo);
                                uo = uv.offset;
                                firstUserFields.push(`  field=${uf} varint=${uv.value}`);
                            } else if (uw === 2) {
                                const ul = readVarint(userBuf, uo);
                                uo = ul.offset;
                                const ud = userBuf.subarray(uo, uo + ul.value);
                                uo += ul.value;
                                const str = ud.toString("utf8");
                                firstUserFields.push(`  field=${uf} bytes(${ul.value}) "${str.substring(0, 50)}"`);
                            } else {
                                break;
                            }
                        }
                        break;
                    }
                    if (iw === 0) {
                        const iv = readVarint(data, tio);
                        tio = iv.offset;
                    } else {
                        break;
                    }
                }
                break;
            }
        } else if (w2 === 0) {
            const v2 = readVarint(decrypted, off2);
            off2 = v2.offset;
        } else {
            break;
        }
    }
    for (const f of firstUserFields) console.log(f);

    // 同时请求活动排名做对比
    console.log("\n=== 对比：活动排名 (event 316 live_try) ===");
    const eventUrl = new URL(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`, CN_BASE_URL).toString();
    const eRes1 = await fetch(eventUrl, { headers: buildCnRankingHeaders(rid) }); // 复用月榜的 rid
    const eDec1 = decryptCn(Buffer.from(await eRes1.arrayBuffer()));
    console.log(`HTTP ${eRes1.status}, ${eDec1.length}B`);

    if (eRes1.status === 200 && eDec1.length > 0) {
        const { bandoriEventRankingParser } = await import("@/parsers/GarupaEventRankingParser");
        const eParsed = bandoriEventRankingParser.parse(eDec1, "live_try");
        const eTop = eParsed.eventPointTopUsers ?? [];
        console.log(`活动 Top: ${eTop.length} 人`);
        for (const u of eTop.slice(0, 3)) {
            console.log(`  #${u.tier} ${u.name} pt:${u.point} uid:${u.uid}`);
        }
    } else {
        console.log(`活动数据获取失败`);
    }
}

main().catch(console.error);
