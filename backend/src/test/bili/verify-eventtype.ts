/**
 * Verify: raw protobuf eventType field value in event info response.
 * Confirms whether the value is "livetry" or "live_try".
 */
import { Buffer } from "node:buffer";
import type { GarupaMasterEventListResponse } from "@/types/garupaSchema";
import { buildCnInfoHeaders, CN_BASE_URL, decryptCn } from "./config";

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
    // Fetch CN event info
    const url = new URL("event", CN_BASE_URL).toString();
    const resp = await fetch(url, { headers: buildCnInfoHeaders() });
    const raw = Buffer.from(await resp.arrayBuffer());
    const decrypted = decryptCn(raw);
    console.log(`CN Event Info: ${decrypted.length}B\n`);

    // Manually iterate protobuf to find the first event's eventType (field 2)
    let offset = 0;
    let foundEventType = false;

    // field 1 of masterEventListSchema is "entries" (repeated message)
    while (offset < decrypted.length && !foundEventType) {
        const key = readVarint(decrypted, offset);
        offset = key.offset;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 2) {
            const len = readVarint(decrypted, offset);
            offset = len.offset;
            if (field === 1) {
                // First event message inside entries
                const inner = decrypted.subarray(offset, offset + len.value);
                let innerOffset = 0;
                while (innerOffset < inner.length) {
                    const ik = readVarint(inner, innerOffset);
                    innerOffset = ik.offset;
                    const ifield = ik.value >> 3;
                    const iwt = ik.value & 0x07;
                    if (iwt === 2) {
                        const ilen = readVarint(inner, innerOffset);
                        innerOffset = ilen.offset;
                        const idata = inner.subarray(innerOffset, innerOffset + ilen.value);
                        innerOffset += ilen.value;
                        if (ifield === 2) {
                            // eventType!
                            const typeStr = idata.toString("utf8");
                            const hex = idata.toString("hex");
                            console.log(`eventType field (raw hex): ${hex}`);
                            console.log(`eventType field (utf8):   "${typeStr}"`);
                            console.log(`\nResult: raw protobuf value = "${typeStr}"`);

                            foundEventType = true;
                            break;
                        }
                    } else if (iwt === 0) {
                        const iv = readVarint(inner, innerOffset);
                        innerOffset = iv.offset;
                        if (ifield === 1) console.log(`eventId: ${iv.value}`);
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

    // Also decode with GarupaParser for comparison
    console.log("\n--- GarupaParser decode result ---");
    const { masterEventListSchema } = await import("@/types/garupaSchema");
    const { GarupaParser } = await import("@/parsers/GarupaParser");
    const parser = new GarupaParser();
    const decoded = parser.decode(decrypted, masterEventListSchema) as GarupaMasterEventListResponse;
    const entries = decoded.entries ?? [];
    for (const e of entries) {
        console.log(`eventId=${e.eventId}, eventType="${e.eventType}", eventName="${e.eventName}"`);
    }
}

main().catch(console.error);
