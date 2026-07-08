/**
 * 国服 (CN Server) 连通性 + X-Requestid 探查脚本
 *
 * 验证国服 API 基础连通性、X-Requestid 校验机制、解密正确性。
 * 已确认: /application 端点不校验 rid，ranking 端点需要正确 rid。
 *
 * 用法:
 *   npx tsx src/test/bili/research-bili-connect.ts
 *   npx tsx src/test/bili/research-bili-connect.ts --requestid <rid>
 */
import { Buffer } from "node:buffer";
import { buildCnInfoHeaders, buildCnRankingHeaders, CN_BASE_URL, CN_UID, decryptCn } from "./config";
import { eventTypeToUrlSegment } from "./eventTypeMapping";

function generateRandomRequestId(): string {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

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

interface RequestIdError {
    errorCode: number;
    message: string;
    newRequestId: string | null;
}

function decodeErrorResponse(decrypted: Buffer): RequestIdError | null {
    let offset = 0;
    let errorCode = 0;
    let message = "";

    while (offset < decrypted.length) {
        const key = readVarint(decrypted, offset);
        offset = key.offset;
        const field = key.value >> 3;
        const wireType = key.value & 0x07;

        if (wireType === 0) {
            const val = readVarint(decrypted, offset);
            offset = val.offset;
            if (field === 1) errorCode = val.value;
        } else if (wireType === 2) {
            const len = readVarint(decrypted, offset);
            offset = len.offset;
            const data = decrypted.subarray(offset, offset + len.value);
            offset += len.value;
            if (field === 3) message = data.toString("utf8");
        } else {
            break;
        }
    }

    if (errorCode === 405 && message.includes("X-Requestid error")) {
        const match = message.match(/\[newRequestId:([a-f0-9]+)\]/i);
        return { errorCode, message, newRequestId: match?.[1] ?? null };
    }

    return { errorCode, message, newRequestId: null };
}

async function testApplication(requestId: string, label: string): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Test: ${label}`);
    console.log(`Endpoint: /application, rid: ${requestId.substring(0, 16)}...`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL("application", CN_BASE_URL).toString();
    try {
        const response = await fetch(url, { headers: buildCnRankingHeaders(requestId) });
        const bodyBuffer = Buffer.from(await response.arrayBuffer());
        const decrypted = decryptCn(bodyBuffer);
        console.log(`HTTP ${response.status}, ${decrypted.length}B`);
        console.log(`First 32B hex: ${decrypted.subarray(0, Math.min(32, decrypted.length)).toString("hex")}`);

        if (response.status !== 200) {
            const err = decodeErrorResponse(decrypted);
            if (err?.newRequestId) {
                console.log(`  newRequestId: ${err.newRequestId}`);
            }
        }
    } catch (err) {
        console.error(`Request failed: ${(err as Error).message}`);
    }
}

async function testRankingEndpoint(endpoint: string, requestId: string, label: string): Promise<void> {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Test: ${label}`);
    console.log(`Endpoint: ${endpoint}`);
    console.log(`rid: ${requestId.substring(0, 16)}...`);
    console.log(`${"=".repeat(60)}`);

    const url = new URL(endpoint, CN_BASE_URL).toString();
    try {
        const response = await fetch(url, { headers: buildCnRankingHeaders(requestId) });
        const bodyBuffer = Buffer.from(await response.arrayBuffer());

        if (bodyBuffer.length === 0) {
            console.log(`HTTP ${response.status}, empty body`);
            return;
        }

        const decrypted = decryptCn(bodyBuffer);
        console.log(`HTTP ${response.status}, ${decrypted.length}B`);

        if (response.status === 200) {
            console.log(`First 32B hex: ${decrypted.subarray(0, Math.min(32, decrypted.length)).toString("hex")}`);
        } else {
            const err = decodeErrorResponse(decrypted);
            if (err) {
                console.log(`  Error code: ${err.errorCode}`);
                console.log(`  Message: ${err.message.substring(0, 200)}`);
                if (err.newRequestId) {
                    console.log(`  newRequestId: ${err.newRequestId}`);
                }
            } else {
                console.log(`  Raw hex: ${decrypted.subarray(0, Math.min(64, decrypted.length)).toString("hex")}`);
            }
        }
    } catch (err) {
        console.error(`Request failed: ${(err as Error).message}`);
    }
}

const main = async (): Promise<void> => {
    const args = process.argv.slice(2);
    const customRid = args.find((a) => a.startsWith("--requestid="))?.split("=")[1];

    console.log("=== CN Server API Connectivity Research ===");
    console.log(`UID: ${CN_UID}`);
    console.log();

    // /application (no rid validation)
    const appUrl = new URL("application", CN_BASE_URL).toString();
    {
        const r = await fetch(appUrl, { headers: buildCnInfoHeaders() });
        const dec = decryptCn(Buffer.from(await r.arrayBuffer()));
        console.log(`/application (no rid): HTTP ${r.status}, ${dec.length}B`);
    }

    await testApplication(generateRandomRequestId(), "Random rid");
    if (customRid) await testApplication(customRid, "Custom rid");

    // Event ranking
    console.log("\n\n========== Event Ranking ==========");
    await testRankingEndpoint(`user/${CN_UID}/event/316/${eventTypeToUrlSegment("live_try")}/ranking`, generateRandomRequestId(), "Random rid");

    // Monthly ranking
    console.log("\n\n========== Monthly Ranking ==========");
    await testRankingEndpoint(`user/${CN_UID}/monthlyranking/18/ranking`, generateRandomRequestId(), "Random rid");

    console.log("\n\n========== Done ==========");
};

void main().catch((error) => {
    console.error("Script error:", error);
    process.exitCode = 1;
});
