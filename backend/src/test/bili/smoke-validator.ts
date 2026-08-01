/**
 * Smoke test: 验证 GarupaResponseValidator 逻辑
 * - 活动榜数据 → 活动校验通过
 * - 月榜数据 → 月榜校验通过
 * - 交叉校验：月榜数据过活动校验应失败，活动数据过月榜校验应失败
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { GarupaParser } from "@/parsers/GarupaParser";
import { buildUsers } from "@/parsers/GarupaRankingParser";
import { validateEventRanking, validateMonthlyRanking } from "@/parsers/GarupaResponseValidator";
import type { EventRankingBandoriRaw, MusicRankingBandoriRaw } from "@/types/event";
import type { GarupaChallengeEventRankingResponse, GarupaChallengeMusicRankingResponse, GarupaMonthlyRankingRankingResponse } from "@/types/garupaSchema";
import { userChallengeEventRankingResponseSchema, userMonthlyRankingRankingResponseSchema } from "@/types/garupaSchema";
import type { MonthlyRankingBandoriRaw } from "@/types/monthlyRanking";
import { CN_BASE_URL, CN_UID, decryptCn } from "./config";

const dotenvPath = require("node:path").resolve(__dirname, "..", "..", "..", ".env");
require("dotenv").config({ path: dotenvPath });
const RKEYS = (process.env.GARUPA_RKEYS ?? "-,-,-,-").split(",").map((s) => s.trim());
const CN_RKEY = RKEYS[3];
const CN_UUID = process.env.GARUPA_UUIDS?.split(",")[3]?.trim() ?? "";
const CN_CID = process.env.GARUPA_CIDS?.split(",")[3]?.trim() ?? "";
const CN_PID = process.env.GARUPA_PIDS?.split(",")[3]?.trim() ?? "";

function randomRid() {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
function hash(rkey: string, nonce: string): string {
    return crypto
        .createHash("md5")
        .update(rkey + nonce)
        .digest("hex");
}
function gameHeaders(rid: string): Record<string, string> {
    const h: Record<string, string> = {
        "User-Agent": "UnityPlayer/2021.3.45f2 (UnityWebRequest/1.0, libcurl/8.5.0-DEV)",
        "X-Unity-Version": "2021.3.45f2",
        "X-ClientPlatform": "Android",
        "X-ClientVersion": "9.4.4",
        "X-Signature": CN_UUID,
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
        "X-Requestid": rid,
    };
    if (CN_CID && CN_CID !== "-") h["X-ChannelID"] = CN_CID;
    if (CN_PID && CN_PID !== "-") h["X-PlatformID"] = CN_PID;
    return h;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function extractNewRequestId(body: Buffer): string | null {
    return body.toString("utf8").match(/\[newRequestId:([a-f0-9]+)\]/i)?.[1] ?? null;
}

async function main() {
    console.log("=== GarupaResponseValidator Smoke Test ===\n");

    const CN = 3;

    // Bootstrap RID chain
    const eUrl = new URL(`user/${CN_UID}/event/317/challenge/ranking`, CN_BASE_URL).toString();
    const r0 = await fetch(eUrl, { headers: gameHeaders(randomRid()) });
    const recoverRid = extractNewRequestId(decryptCn(Buffer.from(await r0.arrayBuffer())));
    if (!recoverRid) {
        console.log("❌ bootstrap failed");
        return;
    }
    await sleep(500);

    const r1 = await fetch(eUrl, { headers: gameHeaders(recoverRid) });
    const hdrNonce = r1.headers.get("x-requestid");
    if (!hdrNonce) {
        console.log("❌ no header nonce");
        return;
    }

    // Fetch event ranking
    const eventBuf = decryptCn(Buffer.from(await r1.arrayBuffer()));
    const parser = new GarupaParser();

    // Parse event with event schema
    const evDecoded = parser.decode<GarupaChallengeEventRankingResponse>(eventBuf, userChallengeEventRankingResponseSchema);

    // Build event report
    const buildMusic = (e: GarupaChallengeMusicRankingResponse): MusicRankingBandoriRaw => ({
        musicId: typeof e.musicId === "number" ? e.musicId : 0,
        scoreTopUsers: buildUsers(e.scoreTopUsers),
        scoreBorderUsers: buildUsers(e.scoreBorderUsers),
    });
    const evReport: EventRankingBandoriRaw = {
        eventPointTopUsers: buildUsers(evDecoded.eventPointTopUsers),
        eventPointBorderUsers: buildUsers(evDecoded.eventPointBorderUsers),
        musicRankings: (evDecoded.challengeMusicRankings ?? []).map(buildMusic),
    };

    // Fetch monthly ranking
    await sleep(500);
    const mUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const rM = await fetch(mUrl, { headers: gameHeaders(hash(CN_RKEY, hdrNonce)) });
    const mBuf = decryptCn(Buffer.from(await rM.arrayBuffer()));
    if (rM.status !== 200) {
        console.log(`月榜 HTTP ${rM.status}`);
        return;
    }

    const mDecoded = parser.decode<GarupaMonthlyRankingRankingResponse>(mBuf, userMonthlyRankingRankingResponseSchema);
    const mReport: MonthlyRankingBandoriRaw = {
        monthlyRankingPointTopUsers: buildUsers(mDecoded.monthlyRankingPointTopUsers),
        monthlyRankingPointBorderUsers: buildUsers(mDecoded.monthlyRankingPointBorderUsers),
    };

    // Run validators
    // Test 1: event data → event validator
    const r1v = validateEventRanking(evReport, CN);
    console.log(`活动榜数据 → 活动校验: ${r1v.valid ? "✅ 通过" : `❌ ${r1v.reason}`}`);

    // Test 2: monthly data → monthly validator
    const r2v = validateMonthlyRanking(mReport, CN);
    console.log(`月榜数据 → 月榜校验: ${r2v.valid ? "✅ 通过" : `❌ ${r2v.reason}`}`);

    // Test 3: monthly data → event validator (should fail)
    const r3v = validateEventRanking({ eventPointBorderUsers: mReport.monthlyRankingPointBorderUsers }, CN);
    console.log(`月榜数据 → 活动校验: ${r3v.valid ? "❌ 应拒绝却通过" : `✅ 正确拒绝: ${r3v.reason}`}`);

    // Test 4: event data → monthly validator (should fail)
    const r4v = validateMonthlyRanking({ monthlyRankingPointBorderUsers: evReport.eventPointBorderUsers ?? [], monthlyRankingPointTopUsers: [] }, CN);
    console.log(`活动数据 → 月榜校验: ${r4v.valid ? "❌ 应拒绝却通过" : `✅ 正确拒绝: ${r4v.reason}`}`);

    console.log("\n=== Smoke test done ===");
}

main().catch(console.error);
