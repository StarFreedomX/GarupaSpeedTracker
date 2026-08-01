/**
 * 调试脚本：从 Garupa API 拉取 event 338 排名数据，
 * 检查 uid=92161183 的 userProfileSituation 字段
 *
 * 用法：npx tsx src/test/debug-sid-zero.ts
 */

import { Buffer } from "node:buffer";
import * as crypto from "node:crypto";
import {
    GARUPA_CLIENT_PLATFORMS,
    GARUPA_ENCRYPTION_IVS,
    GARUPA_ENCRYPTION_KEYS,
    GARUPA_SERVER_BASES,
    GARUPA_UIDS,
    GARUPA_UNITY_VERSIONS,
    GARUPA_USER_AGENTS,
    GARUPA_UUIDS,
} from "@/config";
import { GarupaParser } from "@/parsers/GarupaParser";
import {
    userChallengeEventRankingResponseSchema,
    userLiveTryEventRankingResponseSchema,
    userMedleyEventRankingResponseSchema,
    userMissionLiveEventRankingResponseSchema,
    userStoryEventRankingResponseSchema,
    userTeamLiveFestivalEventRankingResponseSchema,
    userVersusEventRankingResponseSchema,
} from "@/types/garupaSchema";

const TARGET_UID = 92161183;
const SERVER = 0;
const EVENT_ID = 338;

const resolveServerValue = (values: string[], server: number): string => {
    const raw = values[server] ?? values[0] ?? "";
    if (!raw.trim() || raw.trim() === "-") throw new Error(`missing config for server ${server}`);
    return raw.trim();
};

const fetchAndDecrypt = async (server: number, url: URL, clientVersion: string): Promise<Buffer> => {
    const headers = {
        "User-Agent": resolveServerValue(GARUPA_USER_AGENTS, server),
        "X-Unity-Version": resolveServerValue(GARUPA_UNITY_VERSIONS, server),
        "X-ClientPlatform": resolveServerValue(GARUPA_CLIENT_PLATFORMS, server),
        "X-ClientVersion": clientVersion,
        "X-Signature": resolveServerValue(GARUPA_UUIDS, server),
        "Accept-Encoding": "deflate, gzip",
        "Content-Type": "application/octet-stream",
        Accept: "application/octet-stream",
    } as const;

    const response = await fetch(url.toString(), { headers });
    console.log(`  HTTP ${response.status}`);

    const encrypted = Buffer.from(await response.arrayBuffer());
    const decipher = crypto.createDecipheriv(
        "aes-128-cbc",
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_KEYS, server)),
        Buffer.from(resolveServerValue(GARUPA_ENCRYPTION_IVS, server)),
    );
    decipher.setAutoPadding(false);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

const RANKING_SCHEMA_MAP: Record<string, { name: string; schema: Record<number, unknown> }> = {
    medley: { name: "medley", schema: userMedleyEventRankingResponseSchema },
    challenge: { name: "challenge", schema: userChallengeEventRankingResponseSchema },
    versus: { name: "versus", schema: userVersusEventRankingResponseSchema },
    live_try: { name: "live_try", schema: userLiveTryEventRankingResponseSchema },
    story: { name: "story", schema: userStoryEventRankingResponseSchema },
    mission_live: { name: "mission_live", schema: userMissionLiveEventRankingResponseSchema },
    team_live_festival: { name: "team_live_festival", schema: userTeamLiveFestivalEventRankingResponseSchema },
};

const main = async (): Promise<void> => {
    console.log(`=== Debug sid=0: uid=${TARGET_UID}, server=${SERVER}, event=${EVENT_ID} ===\n`);

    // Step 1: 从 Apple App Store 获取 JP 最新客户端版本
    console.log("--- Step 1: Fetch latest client version from App Store ---");
    let clientVersion = "10.1.3";
    try {
        const appleUrl = `https://itunes.apple.com/jp/lookup?bundleId=jp.co.craftegg.band&t=${Date.now()}`;
        const resp = await fetch(appleUrl);
        const data = (await resp.json()) as { results?: Array<{ version?: string }> };
        const ver = data?.results?.[0]?.version;
        if (ver) {
            clientVersion = ver;
            console.log(`  Latest JP version: ${ver}`);
        } else {
            console.log(`  App Store lookup returned no version, using fallback: ${clientVersion}`);
        }
    } catch (e) {
        console.log(`  App Store lookup failed: ${(e as Error).message}, using fallback: ${clientVersion}`);
    }

    // Step 2: 拉取排名数据并遍历所有 eventType
    const base = `https://${resolveServerValue(GARUPA_SERVER_BASES, SERVER).replace(/\/+$/, "")}/api/`;
    const uid = resolveServerValue(GARUPA_UIDS, SERVER);
    const parser = new GarupaParser();

    console.log(`\n--- Step 2: Fetch ranking data (clientVersion=${clientVersion}) ---\n`);

    let foundUser: Record<string, unknown> | null = null;
    let foundType = "";

    for (const type of Object.keys(RANKING_SCHEMA_MAP)) {
        const schemaEntry = RANKING_SCHEMA_MAP[type];
        const rankUrl = new URL(`user/${uid}/event/${EVENT_ID}/${type}/ranking`, base);
        console.log(`Trying "${type}"...`);

        try {
            const payload = await fetchAndDecrypt(SERVER, rankUrl, clientVersion);
            const decoded = parser.decode(payload, schemaEntry.schema as import("@/types/garupaSchema/schemaDefinition").SchemaDefinition) as Record<
                string,
                unknown
            >;

            const candidateContainers = [decoded.eventPointTopUsers, decoded.topUsers, decoded.scoreTopUsers];

            for (const container of candidateContainers) {
                if (!container || typeof container !== "object") continue;
                const entries = (container as { entries?: Array<Record<string, unknown>> }).entries;
                if (!Array.isArray(entries)) continue;
                const target = entries.find((u) => u.userId === TARGET_UID);
                if (target) {
                    foundUser = target;
                    foundType = type;
                    console.log(`  >>> FOUND uid=${TARGET_UID}!\n`);
                    break;
                }
            }

            if (foundUser) break;
            console.log(`  Not found in "${type}"`);
        } catch (err) {
            console.log(`  Error: ${(err as Error).message}`);
        }
    }

    if (foundUser) {
        const pfs = foundUser.userProfileSituation as Record<string, unknown> | undefined;
        console.log(`eventType: ${foundType}`);
        console.log(`name: ${foundUser.name}, rank: ${foundUser.rank}, point: ${foundUser.point}`);
        console.log(`userProfileSituation exists: ${pfs !== undefined && pfs !== null}`);
        if (pfs) {
            console.log(`  situationId: ${pfs.situationId} (type: ${typeof pfs.situationId})`);
            console.log(`  illust: ${pfs.illust}`);
        } else {
            console.log(`  >>> userProfileSituation is UNDEFINED — parseUser produces sid=0`);
        }

        const usl = foundUser.userSituationList as { entries?: Array<Record<string, unknown>> } | undefined;
        console.log(`\nDeck cards: ${usl?.entries?.length ?? 0}`);
        if (usl?.entries?.length) {
            for (const card of usl.entries.slice(0, 5)) {
                console.log(`  situationId=${card.situationId}, illust=${card.illust}, level=${card.level}`);
            }
        }
    } else {
        console.log(`\n>>> uid=${TARGET_UID} not found`);
    }
};

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
