/**
 * 验证 parseUser 的 profile card → deck leader fallback 逻辑
 *
 * 修复背景：部分玩家未设置 userProfileSituation（资料展示卡），
 * 导致 sid=0。fallback 到 userDeck.leader（领队卡）。
 *
 * 用法：npx tsx src/test/debug-sid-zero-verify.ts
 */

import { parseUser } from "@/parsers/GarupaRankingParser";
import type { GarupaRankingUser } from "@/types/garupaSchema";

// 场景1：有 profile card，不应触发 fallback
const withProfile: GarupaRankingUser = {
    userId: 38100567,
    name: "いちごだん",
    rankLevel: 300,
    rank: 1,
    point: 5665050,
    userProfileSituation: { userId: 38100567, situationId: 1511, illust: "after_training" },
    userDeck: { deckId: 33, leader: 2492, member1: 2495, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 2492, illust: "after_training", level: 60, skillLevel: 5 }],
    },
};

// 场景2：无 profile card，有 deck leader，应 fallback
const noProfile: GarupaRankingUser = {
    userId: 92161183,
    name: "せなたゃん",
    introduction: "次の対バンまでのんびり",
    rankLevel: 191,
    rank: 9,
    point: 2999475,
    userProfileSituation: {}, // 空消息 — 即 Garupa 返回的 0 字节 message
    userDeck: { deckId: 3, deckName: "Roselia", leader: 2017, member1: 2146, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 2017, illust: "after_training", level: 60, skillLevel: 5 }],
    },
};

// 场景3：无 profile 无 deck — sid 和 strained 应保持 0
const noDeck: GarupaRankingUser = {
    userId: 99999999,
    name: "test",
    rankLevel: 1,
    rank: 999,
    point: 100,
};

// 场景4：leader 卡不在 situationList 中 — sid 应 fallback 但 strained=0
const noMatch: GarupaRankingUser = {
    userId: 111,
    name: "nomatch",
    rankLevel: 1,
    rank: 500,
    point: 1000,
    userDeck: { leader: 9999, deckType: "normal" },
    userSituationList: { entries: [{ situationId: 1111, illust: "after_training" }] },
};

// 场景5：leader=0（无效值）— 不应触发 fallback
const leaderZero: GarupaRankingUser = {
    userId: 222,
    name: "zeroLeader",
    rankLevel: 1,
    rank: 500,
    point: 1000,
    userDeck: { leader: 0, deckType: "normal" },
    userSituationList: { entries: [] },
};

const cases: Array<{ label: string; user: GarupaRankingUser; expectedSid: number; expectedStrained: number }> = [
    { label: "With profile card", user: withProfile, expectedSid: 1511, expectedStrained: 1 },
    { label: "No profile, fallback to leader", user: noProfile, expectedSid: 2017, expectedStrained: 1 },
    { label: "No profile, no deck", user: noDeck, expectedSid: 0, expectedStrained: 0 },
    { label: "Leader not in situationList", user: noMatch, expectedSid: 9999, expectedStrained: 0 },
    { label: "Leader=0 (invalid)", user: leaderZero, expectedSid: 0, expectedStrained: 0 },
];

let passed = 0;
let failed = 0;

for (const tc of cases) {
    const result = parseUser(tc.user);
    const sidOk = result.sid === tc.expectedSid;
    const strainedOk = result.strained === tc.expectedStrained;
    const ok = sidOk && strainedOk;

    console.log(`${ok ? "✅" : "❌"} ${tc.label}`);
    console.log(`   sid: ${result.sid} (expected ${tc.expectedSid})${sidOk ? "" : " ❌"}`);
    console.log(`   strained: ${result.strained} (expected ${tc.expectedStrained})${strainedOk ? "" : " ❌"}`);

    if (ok) passed++;
    else failed++;
}

console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
