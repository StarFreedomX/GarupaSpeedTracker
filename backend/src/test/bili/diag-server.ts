/**
 * 验证：国服活动榜 border users 是否有 rank≈1500，月榜是否没有
 */
import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import { GarupaParser } from "@/parsers/GarupaParser";
import type { GarupaChallengeEventRankingResponse, GarupaMonthlyRankingRankingResponse } from "@/types/garupaSchema";
import { userChallengeEventRankingResponseSchema, userMonthlyRankingRankingResponseSchema } from "@/types/garupaSchema";
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
    // bootstrap
    const eUrl = new URL(`user/${CN_UID}/event/317/challenge/ranking`, CN_BASE_URL).toString();
    const r0 = await fetch(eUrl, { headers: gameHeaders(randomRid()) });
    const recoverRid = extractNewRequestId(decryptCn(Buffer.from(await r0.arrayBuffer())));
    if (!recoverRid) {
        console.log("❌");
        return;
    }
    await sleep(500);

    const r1 = await fetch(eUrl, { headers: gameHeaders(recoverRid) });
    const hdr1 = r1.headers.get("x-requestid");
    if (!hdr1) {
        console.log("❌");
        return;
    }
    const eventBuf = decryptCn(Buffer.from(await r1.arrayBuffer()));

    const parser = new GarupaParser();
    const ev = parser.decode<GarupaChallengeEventRankingResponse>(eventBuf, userChallengeEventRankingResponseSchema);

    // 活动榜 border users
    const evBorder = ev.eventPointBorderUsers?.entries ?? [];
    console.log(`=== 活动榜 border users (共 ${evBorder.length} 人) ===`);
    for (const u of evBorder) {
        const rank = u.rank ?? 0;
        if (rank >= 1480 && rank <= 1520) {
            console.log(`  命中 rank=${rank}, name="${u.name}", point=${u.point}`);
        }
    }
    console.log(`  rank 范围: ${evBorder[0]?.rank ?? "?"} ~ ${evBorder[evBorder.length - 1]?.rank ?? "?"}`);

    // 月榜
    await sleep(500);
    const mUrl = new URL(`user/${CN_UID}/monthlyranking/18/ranking`, CN_BASE_URL).toString();
    const rM = await fetch(mUrl, { headers: gameHeaders(hash(CN_RKEY, hdr1)) });
    const decM = decryptCn(Buffer.from(await rM.arrayBuffer()));
    if (rM.status !== 200) {
        console.log(`月榜 HTTP ${rM.status}`);
        return;
    }

    const m = parser.decode<GarupaMonthlyRankingRankingResponse>(decM, userMonthlyRankingRankingResponseSchema);
    const mBorder = m.monthlyRankingPointBorderUsers?.entries ?? [];
    console.log(`\n=== 月榜 border users (共 ${mBorder.length} 人) ===`);
    let found1500 = false;
    for (const u of mBorder) {
        const rank = u.rank ?? 0;
        if (rank >= 1480 && rank <= 1520) {
            console.log(`  rank=${rank}, name="${u.name}"`);
            found1500 = true;
        }
    }
    if (!found1500) console.log(`  没有 rank≈1500 的用户 ✅`);
    console.log(`  rank 范围: ${mBorder[0]?.rank ?? "?"} ~ ${mBorder[mBorder.length - 1]?.rank ?? "?"}`);
}

main().catch(console.error);
