/**
 * 验证 parseUser 的 profile card → deck leader fallback 逻辑
 *
 * 游戏有两种资料展示卡模式（viewProfileSituationStatus）：
 *   "profile_situation" → 显示玩家选定的资料展示卡
 *   "deck_leader" / 空 → 显示主乐队领队卡
 *
 * 修复：parseUser 现在与游戏客户端行为一致，通过 viewProfileSituationStatus 决定
 * 使用 userProfileSituation 还是 userDeck.leader。
 *
 * 用法：npx tsx src/test/debug-sid-zero-verify.ts
 */

import { parseUser } from "@/parsers/GarupaRankingParser";
import type { GarupaRankingUser } from "@/types/garupaSchema";

// 场景1：profile_situation 模式 — 使用 profile 卡
const profileMode: GarupaRankingUser = {
    userId: 38100567,
    name: "いちごだん",
    rankLevel: 300,
    rank: 1,
    point: 5665050,
    userProfileSituation: {
        userId: 38100567,
        situationId: 1511,
        illust: "after_training",
        viewProfileSituationStatus: "profile_situation",
    },
    userDeck: { deckId: 33, leader: 2492, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 2492, illust: "normal" }],
    },
};

// 场景2：profile 卡为空（0字节空消息） — 应 fallback 到领队卡
const emptyProfile: GarupaRankingUser = {
    userId: 92161183,
    name: "せなたゃん",
    introduction: "次の対バンまでのんびり",
    rankLevel: 191,
    rank: 9,
    point: 2999475,
    userProfileSituation: {}, // 空消息
    userDeck: { deckId: 3, deckName: "Roselia", leader: 2017, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 2017, illust: "after_training" }],
    },
};

// 场景3：deck_leader 模式 — 即使 profile situationId 有值，也应显示领队卡
const deckLeaderMode: GarupaRankingUser = {
    userId: 100,
    name: "deckLeaderPlayer",
    rankLevel: 100,
    rank: 50,
    point: 1000000,
    userProfileSituation: {
        userId: 100,
        situationId: 9999, // 之前选过的卡，但现在已切换到领队模式
        illust: "normal",
        viewProfileSituationStatus: "deck_leader",
    },
    userDeck: { deckId: 1, leader: 5555, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 5555, illust: "after_training" }],
    },
};

// 场景4：userProfileSituation 完全不存在 — fallback 到领队卡
const noProfileField: GarupaRankingUser = {
    userId: 99999999,
    name: "test",
    rankLevel: 1,
    rank: 999,
    point: 100,
    // no userProfileSituation at all
    userDeck: { deckId: 5, leader: 3000, deckType: "normal" },
    userSituationList: {
        entries: [{ situationId: 3000, illust: "normal" }],
    },
};

// 场景5：无 profile 无 deck — sid 和 strained 为 0
const noDeck: GarupaRankingUser = {
    userId: 222,
    name: "noDeck",
    rankLevel: 1,
    rank: 999,
    point: 100,
};

// 场景6：领队卡不在 situationList 中 — sid fallback 但 strained=0
const noMatch: GarupaRankingUser = {
    userId: 111,
    name: "nomatch",
    rankLevel: 1,
    rank: 500,
    point: 1000,
    userDeck: { leader: 9999, deckType: "normal" },
    userSituationList: { entries: [{ situationId: 1111, illust: "after_training" }] },
};

const cases: Array<{ label: string; user: GarupaRankingUser; expectedSid: number; expectedStrained: number }> = [
    { label: "profile_situation mode → use profile card", user: profileMode, expectedSid: 1511, expectedStrained: 1 },
    { label: "Empty profile → fallback to leader", user: emptyProfile, expectedSid: 2017, expectedStrained: 1 },
    { label: "deck_leader mode → ignore profile, use leader", user: deckLeaderMode, expectedSid: 5555, expectedStrained: 1 },
    { label: "No profile field → fallback to leader", user: noProfileField, expectedSid: 3000, expectedStrained: 0 },
    { label: "No profile, no deck → sid=1 (safe default)", user: noDeck, expectedSid: 1, expectedStrained: 0 },
    { label: "Leader not in situationList → sid fallback, strained=0", user: noMatch, expectedSid: 9999, expectedStrained: 0 },
];

let passed = 0;
let failed = 0;

for (const tc of cases) {
    const result = parseUser(tc.user);
    const sidOk = result.sid === tc.expectedSid;
    const strainedOk = result.strained === tc.expectedStrained;
    const ok = sidOk && strainedOk;

    console.log(`${ok ? "✅" : "❌"} ${tc.label}`);
    if (!sidOk) console.log(`   sid: got ${result.sid}, expected ${tc.expectedSid}`);
    if (!strainedOk) console.log(`   strained: got ${result.strained}, expected ${tc.expectedStrained}`);

    if (ok) passed++;
    else failed++;
}

console.log(`\n${passed}/${cases.length} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
