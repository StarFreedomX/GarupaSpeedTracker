/**
 * 用最新客户端版本验证日服 event info protobuf 中 eventType 的原始值
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { GARUPA_ENCRYPTION_IVS, GARUPA_ENCRYPTION_KEYS, GARUPA_SERVER_BASES, GARUPA_UUIDS } from "@/config";

const JP_INDEX = 0;

const resolveJp = (values: string[], label: string): string => {
    const v = values[JP_INDEX]?.trim() ?? "";
    if (!v || v === "-") throw new Error(`${label} not configured for JP`);
    return v;
};

const JP_BASE = `https://${resolveJp(GARUPA_SERVER_BASES, "GARUPA_SERVER_BASES").replace(/\/+$/, "")}/api/`;
const JP_KEY = resolveJp(GARUPA_ENCRYPTION_KEYS, "GARUPA_ENCRYPTION_KEYS");
const JP_IV = resolveJp(GARUPA_ENCRYPTION_IVS, "GARUPA_ENCRYPTION_IVS");
const JP_UUID = resolveJp(GARUPA_UUIDS, "GARUPA_UUIDS");
const CLIENT_VER = "10.1.3"; // 从 App Store 获取

function decrypt(buf: Buffer): Buffer {
    const d = crypto.createDecipheriv("aes-128-cbc", Buffer.from(JP_KEY), Buffer.from(JP_IV));
    d.setAutoPadding(false);
    return Buffer.concat([d.update(buf), d.final()]);
}

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

async function checkEventType(label: string, baseUrl: string, _encKey: string, _encIv: string, headers: Record<string, string>) {
    console.log(`\n=== ${label} ===`);
    const resp = await fetch(`${baseUrl}event`, { headers });
    console.log(`HTTP ${resp.status}`);

    const raw = Buffer.from(await resp.arrayBuffer());
    const decrypted = decrypt(raw);
    console.log(`Decrypted: ${decrypted.length}B`);

    if (decrypted.length < 10) {
        console.log(`  太小，跳过`);
        return;
    }

    // 找第一个 event 的 eventType
    let offset = 0;
    let count = 0;
    while (offset < decrypted.length && count < 5) {
        const key = readVarint(decrypted, offset);
        offset = key.offset;
        const field = key.value >> 3,
            wireType = key.value & 7;
        if (wireType === 2) {
            const len = readVarint(decrypted, offset);
            offset = len.offset;
            if (field === 1 && count === 0) {
                const inner = decrypted.subarray(offset, offset + len.value);
                let io = 0;
                while (io < inner.length) {
                    const ik = readVarint(inner, io);
                    io = ik.offset;
                    const iff = ik.value >> 3,
                        iw = ik.value & 7;
                    if (iw === 2) {
                        const il = readVarint(inner, io);
                        io = il.offset;
                        const idata = inner.subarray(io, io + il.value);
                        io += il.value;
                        if (iff === 2) {
                            const typeVal = idata.toString("utf8");
                            console.log(`  eventType hex: ${idata.toString("hex")}`);
                            console.log(`  eventType:     "${typeVal}"`);
                        }
                    } else if (iw === 0) {
                        const iv = readVarint(inner, io);
                        io = iv.offset;
                    } else {
                        break;
                    }
                }
                count++;
            }
            offset += len.value;
        } else if (wireType === 0) {
            const v = readVarint(decrypted, offset);
            offset = v.offset;
        } else {
            break;
        }
    }
}

async function main() {
    const jpHeaders: Record<string, string> = {
        "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
        "X-Unity-Version": "2021.3.45f2",
        "X-ClientPlatform": "Android",
        "X-ClientVersion": CLIENT_VER,
        "X-Signature": JP_UUID,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    };

    // JP
    await checkEventType("日服 (JP)", JP_BASE, JP_KEY, JP_IV, jpHeaders);

    // CN (用之前确认过的)
    console.log("\n=== 国服 (CN) - 之前已确认 ===");
    console.log('  eventType: "live_try" (hex: 6c6976655f747279)');
}

main().catch((e) => console.error(e.message));
