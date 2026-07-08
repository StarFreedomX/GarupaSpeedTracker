/**
 * CN Server Event Ranking & Monthly Ranking Research Script
 *
 * Key findings (from research-bili-connect.ts):
 * 1. /api/application does not validate X-Requestid
 * 2. Event/Monthly ranking returns encrypted protobuf error (HTTP 405) on wrong rid
 * 3. Must decode protobuf to extract newRequestId for retry
 *
 * Usage:
 *   npx tsx src/test/bili/research-bili-ranking.ts
 *   npx tsx src/test/bili/research-bili-ranking.ts event 316 live_try
 *   npx tsx src/test/bili/research-bili-ranking.ts monthly 18
 */

import { Buffer } from "node:buffer";
import { bandoriEventRankingParser } from "@/parsers/GarupaEventRankingParser";
import { bandoriMonthlyRankingParser } from "@/parsers/GarupaMonthlyRankingParser";
import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaMasterEventListResponse, GarupaMasterMonthlyRankingListResponse } from "@/types/garupaSchema";
import { buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

// ============================================================================
// Manual protobuf decoding (extract X-Requestid error info)
// ============================================================================

function readVarint(buffer: Buffer, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;
    let cursor = offset;
    while (cursor < buffer.length) {
        const byte = buffer[cursor++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, offset: cursor };
        shift += 7;
        if (shift > 56) throw new Error("varint too large");
    }
    throw new Error("unexpected end");
}

interface ProtoField {
    field: number;
    wireType: number;
    value: number | Buffer;
}

function parseProtoSimple(buffer: Buffer): ProtoField[] {
    const fields: ProtoField[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const key = readVarint(buffer, offset);
        offset = key.offset;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 0) {
            const val = readVarint(buffer, offset);
            offset = val.offset;
            fields.push({ field, wireType, value: val.value });
        } else if (wireType === 2) {
            const len = readVarint(buffer, offset);
            offset = len.offset;
            const data = buffer.subarray(offset, offset + len.value);
            offset += len.value;
            fields.push({ field, wireType, value: data });
        } else {
            break;
        }
    }
    return fields;
}

interface RequestIdError {
    errorCode: number;
    message: string;
    field5: number;
    newRequestId: string | null;
    oldRequestId: string | null;
    sentRequestId: string | null;
}

function decodeRequestIdError(decrypted: Buffer): RequestIdError | null {
    try {
        const fields = parseProtoSimple(decrypted);
        let errorCode = 0;
        let message = "";
        let field5 = 0;

        for (const f of fields) {
            if (f.field === 1 && f.wireType === 0) errorCode = f.value as number;
            if (f.field === 2 && f.wireType === 2) message = (f.value as Buffer).toString("utf8");
            if (f.field === 5 && f.wireType === 0) field5 = f.value as number;
        }

        // Only HTTP 405 with message containing "X-Requestid error" confirms it's a rid error
        if (errorCode === 405 && message.includes("X-Requestid error")) {
            const newRid = message.match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
            const oldRid = message.match(/\[oldRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
            const sentRid = message.match(/\[X-Requestid:([a-f0-9]+)\]/i)?.[1] ?? null;
            return { errorCode, message, field5, newRequestId: newRid, oldRequestId: oldRid, sentRequestId: sentRid };
        }

        return { errorCode, message, field5, newRequestId: null, oldRequestId: null, sentRequestId: null };
    } catch {
        return null;
    }
}

// ============================================================================
// Extract newRequestId (simplified version)
// ============================================================================

function _extractNewRequestIdFromDecrypted(decrypted: Buffer): string | null {
    const error = decodeRequestIdError(decrypted);
    return error?.newRequestId ?? null;
}

// ============================================================================
// Network requests
// ============================================================================

interface FetchResult {
    decrypted: Buffer;
    status: number;
    bodySize: number;
}

async function fetchCnEndpoint(url: string, requestId: string): Promise<FetchResult> {
    const headers = buildCnRankingHeaders(requestId);
    const response = await fetch(url, { headers });
    const arrayBuffer = await response.arrayBuffer();
    const bodyBuffer = Buffer.from(arrayBuffer);
    const decrypted = decryptCn(bodyBuffer);
    return {
        decrypted,
        status: response.status,
        bodySize: bodyBuffer.length,
    };
}

/**
 * Request wrapper with X-Requestid retry.
 * When receiving HTTP 405 error, automatically extract newRequestId and retry.
 */
async function fetchWithRidRetry(
    url: string,
    initialRid: string,
    maxRetries: number = 3,
): Promise<{ decrypted: Buffer; status: number; finalRid: string; retries: number }> {
    let rid = initialRid;
    let retries = 0;

    while (retries <= maxRetries) {
        const result = await fetchCnEndpoint(url, rid);

        // If success (2xx), return directly
        if (result.status >= 200 && result.status < 300) {
            return { decrypted: result.decrypted, status: result.status, finalRid: rid, retries };
        }

        // Check if it's an X-Requestid error
        const error = decodeRequestIdError(result.decrypted);
        if (error?.newRequestId) {
            console.log(`  [Retry ${retries + 1}] X-Requestid error, using new rid: ${error.newRequestId.substring(0, 16)}...`);
            console.log(`    Sent rid: ${error.sentRequestId?.substring(0, 16) ?? "N/A"}...`);
            console.log(`    Expected old: ${error.oldRequestId?.substring(0, 16) ?? "N/A"}...`);
            rid = error.newRequestId;
            retries++;
            continue;
        }

        // Other errors (non rid-related), return directly
        return { decrypted: result.decrypted, status: result.status, finalRid: rid, retries };
    }

    throw new Error(`X-Requestid retries exhausted (${maxRetries} attempts)`);
}

// ============================================================================
// Event Ranking Research
// ============================================================================

async function researchEventRanking(eventId: number, eventType: string): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CN Server Event Ranking Research`);
    console.log(`Event ID: ${eventId}, Type: ${eventType}`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL(`user/${CN_UID}/event/${eventId}/${eventType}/ranking`, CN_BASE_URL).toString();
    console.log(`URL: ${url}`);

    // Generate random initial rid
    const initialRid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    console.log(`Initial rid: ${initialRid}`);

    try {
        const { decrypted, status, finalRid, retries } = await fetchWithRidRetry(url, initialRid);
        console.log(`\nFinal status: HTTP ${status}, retries: ${retries}, final rid: ${finalRid.substring(0, 16)}...`);
        console.log(`Decrypted size: ${decrypted.length} bytes`);

        if (status >= 200 && status < 300) {
            console.log(`\n[Success] Event ranking data fetched successfully, attempting to parse...`);
            try {
                const parsed = bandoriEventRankingParser.parse(decrypted, eventType);
                console.log(`Top users: ${parsed.eventPointTopUsers?.length ?? 0}`);
                console.log(`Border users: ${parsed.eventPointBorderUsers?.length ?? 0}`);
                if (parsed.musicRankings) {
                    console.log(`Music rankings: ${parsed.musicRankings.length}`);
                }
                // Print top 3 users
                if (parsed.eventPointTopUsers && parsed.eventPointTopUsers.length > 0) {
                    console.log(`\nTop 3 users:`);
                    for (const user of parsed.eventPointTopUsers.slice(0, 3)) {
                        console.log(`  #${user.tier} ${user.name} (uid:${user.uid}) pt:${user.point} rank:${user.rank}`);
                    }
                }
                console.log(`\nParse successful! Event ranking structure is valid.`);
            } catch (parseErr) {
                console.error(`Parse failed: ${(parseErr as Error).message}`);
                // Print first 64 bytes of decrypted data
                console.log(`Decrypted data (first 64 bytes): ${decrypted.subarray(0, 64).toString("hex")}`);
            }
        } else {
            // Non-2xx and non-rid error
            const error = decodeRequestIdError(decrypted);
            if (error) {
                console.log(`Error code: ${error.errorCode}, message: ${error.message.substring(0, 200)}`);
            } else {
                console.log(`Unknown error, decrypted data hex: ${decrypted.subarray(0, 64).toString("hex")}`);
            }
        }
    } catch (err) {
        console.error(`Request error: ${(err as Error).message}`);
    }
}

// ============================================================================
// Monthly Ranking Research
// ============================================================================

async function researchMonthlyRanking(monthlyId: number): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CN Server Monthly Ranking Research`);
    console.log(`Monthly ID: ${monthlyId}`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL(`user/${CN_UID}/monthlyranking/${monthlyId}/ranking`, CN_BASE_URL).toString();
    console.log(`URL: ${url}`);

    const initialRid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    console.log(`Initial rid: ${initialRid}`);

    try {
        const { decrypted, status, finalRid, retries } = await fetchWithRidRetry(url, initialRid);
        console.log(`\nFinal status: HTTP ${status}, retries: ${retries}, final rid: ${finalRid.substring(0, 16)}...`);
        console.log(`Decrypted size: ${decrypted.length} bytes`);

        if (status >= 200 && status < 300) {
            console.log(`\n[Success] Monthly ranking data fetched successfully, attempting to parse...`);
            try {
                const parsed = bandoriMonthlyRankingParser.parse(decrypted);
                console.log(`Top users: ${parsed.monthlyRankingPointTopUsers?.length ?? 0}`);
                console.log(`Border users: ${parsed.monthlyRankingPointBorderUsers?.length ?? 0}`);
                if (parsed.monthlyRankingPointTopUsers && parsed.monthlyRankingPointTopUsers.length > 0) {
                    console.log(`\nTop 3 users:`);
                    for (const user of parsed.monthlyRankingPointTopUsers.slice(0, 3)) {
                        console.log(`  #${user.tier} ${user.name} (uid:${user.uid}) pt:${user.point} rank:${user.rank}`);
                    }
                }
                console.log(`\nParse successful! Monthly ranking structure is valid.`);
            } catch (parseErr) {
                console.error(`Parse failed: ${(parseErr as Error).message}`);
                console.log(`Decrypted data (first 64 bytes): ${decrypted.subarray(0, 64).toString("hex")}`);
            }
        } else {
            const error = decodeRequestIdError(decrypted);
            if (error) {
                console.log(`Error code: ${error.errorCode}, message: ${error.message.substring(0, 200)}`);
            } else {
                console.log(`Unknown error, decrypted data hex: ${decrypted.subarray(0, 64).toString("hex")}`);
            }
        }
    } catch (err) {
        console.error(`Request error: ${(err as Error).message}`);
    }
}

// ============================================================================
// Event Info (Master List) Research
// ============================================================================

async function researchEventInfo(): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CN Server Event Info (Master List) Research`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL("event", CN_BASE_URL).toString();
    console.log(`URL: ${url}`);

    const initialRid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    console.log(`Initial rid: ${initialRid}`);

    try {
        const { decrypted, status, retries } = await fetchWithRidRetry(url, initialRid);
        console.log(`Final status: HTTP ${status}, retries: ${retries}`);
        console.log(`Decrypted size: ${decrypted.length} bytes`);

        if (status >= 200 && status < 300) {
            console.log(`\n[Success] Event info fetched successfully`);
            // Decode event list using GarupaParser
            const { masterEventListSchema } = await import("@/types/garupaSchema");
            const parser = new GarupaParser();
            const decoded = parser.decode(decrypted, masterEventListSchema);
            const entries = (decoded as GarupaMasterEventListResponse).entries ?? [];
            console.log(`Total events: ${entries.length}`);
            if (entries.length > 0) {
                console.log(`\nLast 5 events:`);
                for (const entry of entries.slice(-5)) {
                    console.log(`  ID:${entry.eventId} Type:${entry.eventType} Name:${entry.eventName ?? "N/A"}`);
                }
            }
        } else {
            const error = decodeRequestIdError(decrypted);
            if (error) {
                console.log(`Error code: ${error.errorCode}, message: ${error.message.substring(0, 200)}`);
            }
        }
    } catch (err) {
        console.error(`Request error: ${(err as Error).message}`);
    }
}

// ============================================================================
// Monthly Ranking Info (Master List) Research
// ============================================================================

async function researchMonthlyRankingInfo(): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CN Server Monthly Ranking Info (Master List) Research`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL("monthlyranking", CN_BASE_URL).toString();
    console.log(`URL: ${url}`);

    const initialRid = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    console.log(`Initial rid: ${initialRid}`);

    try {
        const { decrypted, status, retries } = await fetchWithRidRetry(url, initialRid);
        console.log(`Final status: HTTP ${status}, retries: ${retries}`);
        console.log(`Decrypted size: ${decrypted.length} bytes`);

        if (status >= 200 && status < 300) {
            console.log(`\n[Success] Monthly ranking info fetched successfully`);
            const { masterMonthlyRankingListSchema } = await import("@/types/garupaSchema");
            const parser = new GarupaParser();
            const decoded = parser.decode(decrypted, masterMonthlyRankingListSchema);
            const entries = (decoded as GarupaMasterMonthlyRankingListResponse).entries ?? [];
            console.log(`Total monthly rankings: ${entries.length}`);
            if (entries.length > 0) {
                console.log(`\nLast 5 monthly rankings:`);
                for (const entry of entries.slice(-5)) {
                    console.log(`  ID:${entry.monthlyRankingId} Name:${entry.monthlyRankingName ?? "N/A"}`);
                }
            }
        } else {
            const error = decodeRequestIdError(decrypted);
            if (error) {
                console.log(`Error code: ${error.errorCode}, message: ${error.message.substring(0, 200)}`);
            }
        }
    } catch (err) {
        console.error(`Request error: ${(err as Error).message}`);
    }
}

// ============================================================================
// Application (version check - simple verification)
// ============================================================================

async function researchApplication(): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`CN Server Application Endpoint (version check)`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL("application", CN_BASE_URL).toString();
    const headers = buildCnRankingHeaders("00000000000000000000000000000000"); // arbitrary rid

    try {
        const response = await fetch(url, { headers });
        const bodyBuffer = Buffer.from(await response.arrayBuffer());
        const decrypted = decryptCn(bodyBuffer);
        console.log(`HTTP ${response.status}, decrypted: ${decrypted.length} bytes`);
        // First few bytes contain version string etc.
        const textPreview = decrypted.toString("utf8").replace(/[^\x20-\x7e]/g, ".");
        console.log(`Readable content: ${textPreview.substring(0, 200)}`);
    } catch (err) {
        console.error(`Request error: ${(err as Error).message}`);
    }
}

// ============================================================================
// Main
// ============================================================================

const main = async (): Promise<void> => {
    const args = process.argv.slice(2);
    const mode = args[0] ?? "all";

    console.log("=== CN Server (Bili/CN) API Research Script ===\n");

    switch (mode) {
        case "event": {
            const eventId = Number(args[1] ?? 316);
            const eventType = args[2] ?? eventTypeToUrlSegment("live_try");
            await researchEventRanking(eventId, eventType);
            break;
        }
        case "monthly": {
            const monthlyId = Number(args[1] ?? 18);
            await researchMonthlyRanking(monthlyId);
            break;
        }
        case "event-info":
            await researchEventInfo();
            break;
        case "monthly-info":
            await researchMonthlyRankingInfo();
            break;
        case "app":
            await researchApplication();
            break;
        default: {
            // Research all endpoints in order
            await researchApplication();
            await researchEventInfo();
            await researchMonthlyRankingInfo();
            await researchEventRanking(316, eventTypeToUrlSegment("live_try"));
            await researchMonthlyRanking(18);
            break;
        }
    }

    console.log("\n\n========== Research Complete ==========");
};

void main().catch((error) => {
    console.error("Research script error:", error);
    process.exitCode = 1;
});
