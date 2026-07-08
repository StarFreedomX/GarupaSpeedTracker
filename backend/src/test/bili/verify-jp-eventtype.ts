/**
 * 验证日服 event info protobuf 中 eventType 的原始值
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

const headers: Record<string, string> = {
    "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
    "X-Unity-Version": "2021.3.45f2",
    "X-ClientPlatform": "Android",
    "X-ClientVersion": "10.1.1",
    "X-Signature": JP_UUID,
    "Accept-Encoding": "deflate, gzip",
    "Content-Type": "application/octet-stream",
    Accept: "application/octet-stream",
};

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

async function main() {
    console.log("Fetching JP event info...");
    const resp = await fetch(`${JP_BASE}event`, { headers });
    console.log(`HTTP ${resp.status}`);

    const raw = Buffer.from(await resp.arrayBuffer());
    const decrypted = decrypt(raw);
    console.log(`Decrypted: ${decrypted.length}B\n`);

    // 找第一个 event 的 eventType (field 2)
    let offset = 0;
    while (offset < decrypted.length) {
        const key = readVarint(decrypted, offset);
        offset = key.offset;
        const field = key.value >> 3,
            wireType = key.value & 7;

        if (wireType === 2) {
            const len = readVarint(decrypted, offset);
            offset = len.offset;
            if (field === 1) {
                // entries 里的一个 event
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
                            console.log(`JP eventType hex: ${idata.toString("hex")}`);
                            console.log(`JP eventType:     "${idata.toString("utf8")}"`);
                            return;
                        }
                    } else if (iw === 0) {
                        const iv = readVarint(inner, io);
                        io = iv.offset;
                        if (iff === 1) console.log(`eventId: ${iv.value}`);
                    } else {
                        break;
                    }
                }
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

main().catch((e) => console.error(e.message));
