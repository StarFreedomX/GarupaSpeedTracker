// noinspection DuplicatedCode
/**
 * 技能信息探究脚本（批量版）
 *
 * 与 research-skill-info.ts 功能一致，但卡片元数据改为从
 * https://bestdori.com/api/cards/all.5.json 批量获取（不再逐卡请求）。
 *
 * 用法：npx tsx src/test/research-skill-bulk.ts [playerId] [server]
 */

import { BESTDORI_API } from "@/config";
import { downloader } from "@/storage/downloader";
import { getBandId } from "@/types/bestdori/area-item-meta";

// ============================================================================
// 类型
// ============================================================================

type Attribute = "cool" | "happy" | "pure" | "powerful";

interface CardBulkRaw {
    characterId: number;
    rarity: number;
    attribute: string;
    levelLimit: number;
    skillId: number;
}

interface PlayerEntryRaw {
    situationId: number;
    level: number;
    skillLevel: number;
}

interface SkillRaw {
    simpleDescription: (string | null)[];
    description: (string | null)[];
    duration: number[];
    activationEffect: {
        activateEffectTypes: Record<string, { activateEffectValue: (number | null)[] } | undefined>;
        unificationActivateEffectValue?: number;
        unificationActivateConditionBandId?: number;
        unificationActivateConditionType?: string;
    };
}

interface CardBrief {
    cardId: number;
    characterId: number;
    bandId: number;
    attribute: Attribute;
    skillId: number;
    skillLevel: number;
}

interface SkillResult {
    cardId: number;
    skillId: number;
    skillLevel: number;
    durationSeconds: number;
    bonusPercent: number;
    progressive: { stepRate: number; maxCap: number } | null;
}

// ============================================================================
// 硬编码
// ============================================================================

const PROGRESSIVE_MAP: Record<number, { stepRate: number; maxCap: number }> = { 61: { stepRate: 0.5, maxCap: 150 } };
const SERVER_NAMES = ["jp", "en", "tw", "cn", "kr"] as const;

// ============================================================================
// 数据加载
// ============================================================================

async function loadSkills(): Promise<Record<string, SkillRaw>> {
    const url = new URL("skills/all.10.json", BESTDORI_API).toString();
    console.log(`[load] 技能: ${url}`);
    return downloader.download<Record<string, SkillRaw>>(url);
}

async function loadCardsBulk(): Promise<Record<string, CardBulkRaw>> {
    const url = new URL("cards/all.5.json", BESTDORI_API).toString();
    console.log(`[load] 卡牌(批量): ${url}`);
    return downloader.download<Record<string, CardBulkRaw>>(url);
}

async function loadPlayer(playerId: number, server: number) {
    const serverName = SERVER_NAMES[server] ?? "jp";
    const url = new URL(`player/${serverName}/${playerId}?mode=2`, BESTDORI_API).toString();
    console.log(`[load] 玩家: ${url}`);
    return downloader.download<{
        result: boolean;
        data?: { profile?: { userName: string; mainDeckUserSituations: { entries: PlayerEntryRaw[] } } };
    }>(url);
}

// ============================================================================
// 工具
// ============================================================================

function getAtIndex(arr: (number | null)[], index: number): number | null {
    return arr[index] ?? null;
}

function isUnificationSatisfied(allCards: CardBrief[], skill: SkillRaw): boolean {
    const ae = skill.activationEffect;
    const bandId = ae.unificationActivateConditionBandId;
    const attrType = ae.unificationActivateConditionType;
    if (bandId != null && !allCards.every((c) => c.bandId === bandId)) return false;
    if (attrType != null && !allCards.every((c) => c.attribute.toUpperCase() === attrType?.toUpperCase())) return false;
    return bandId != null || attrType != null;
}

function analyzeSkill(card: CardBrief, skill: SkillRaw, server: number, allCards: CardBrief[]): SkillResult {
    const levelIndex = card.skillLevel - 1;
    const serverIndex = Math.min(server, 4);
    const effectTypes = skill.activationEffect.activateEffectTypes;
    const progressive = PROGRESSIVE_MAP[card.skillId] ?? null;

    let bestBonus = 0;
    const scoringTypes = ["score", "score_only_perfect", "score_over_life", "score_under_life", "score_continued_note_judge", "score_under_great_half"];
    for (const type of scoringTypes) {
        const eff = effectTypes[type];
        if (!eff) continue;
        const v = getAtIndex(eff.activateEffectValue, serverIndex);
        if (v != null && v > bestBonus) bestBonus = v;
    }

    // 统一加成
    const ae = skill.activationEffect;
    if (ae.unificationActivateEffectValue != null && isUnificationSatisfied(allCards, skill)) {
        if (ae.unificationActivateEffectValue > bestBonus) bestBonus = ae.unificationActivateEffectValue;
    }

    const duration = getAtIndex(skill.duration, levelIndex) ?? 0;
    return { cardId: card.cardId, skillId: card.skillId, skillLevel: card.skillLevel, durationSeconds: duration, bonusPercent: bestBonus, progressive };
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
    const args = process.argv.slice(2);
    const playerId = Number(args[0]) || 28012549;
    const server = Number(args[1]) || 0;
    const serverName = SERVER_NAMES[server] ?? "jp";

    console.log("=".repeat(60));
    console.log(`技能信息探究(批量版) — 玩家 ${playerId} (${serverName}服)`);
    console.log("=".repeat(60));

    const [skills, cardsBulk, playerApi] = await Promise.all([loadSkills(), loadCardsBulk(), loadPlayer(playerId, server)]);
    console.log(`[load] 技能 ${Object.keys(skills).length}, 卡牌 ${Object.keys(cardsBulk).length}\n`);

    if (!playerApi.result || !playerApi.data?.profile) {
        console.error("玩家数据获取失败");
        process.exit(1);
    }
    const entries = playerApi.data.profile.mainDeckUserSituations?.entries ?? [];
    console.log(`玩家: ${playerApi.data.profile.userName}, 编队 ${entries.length} 张卡\n`);

    // 从批量数据构建 CardBrief
    const cardBriefs: CardBrief[] = [];
    for (const entry of entries) {
        const bulk = cardsBulk[String(entry.situationId)];
        if (!bulk) {
            console.log(`Card ${entry.situationId}: 未在批量数据中找到`);
            continue;
        }
        const bandId = getBandId(bulk.characterId);
        cardBriefs.push({
            cardId: entry.situationId,
            characterId: bulk.characterId,
            bandId,
            attribute: bulk.attribute as Attribute,
            skillId: bulk.skillId,
            skillLevel: entry.skillLevel,
        });
    }

    for (const card of cardBriefs) {
        const skill = skills[String(card.skillId)];
        if (!skill) {
            console.log(`Card ${card.cardId}: skillId=${card.skillId} 未找到`);
            continue;
        }

        const r = analyzeSkill(card, skill, server, cardBriefs);
        const progStr = r.progressive ? `{stepRate:${r.progressive.stepRate}, maxCap:${r.progressive.maxCap}}` : "null";
        console.log(`Card ${r.cardId} (ch${card.characterId} ${card.attribute}): ${r.durationSeconds}s / ${r.bonusPercent}% / ${progStr}`);
        console.log(`  ${skill.description[0]?.replace(/\n/g, " ")}`);
        console.log();
    }

    // 汇总
    console.log("=".repeat(60));
    console.log("汇总");
    console.log("=".repeat(60));
    for (const card of cardBriefs) {
        const skill = skills[String(card.skillId)];
        if (!skill) continue;
        const r = analyzeSkill(card, skill, server, cardBriefs);
        const progStr = r.progressive ? ` {${r.progressive.stepRate}, ${r.progressive.maxCap}}` : " null";
        console.log(`Card ${r.cardId}: ${r.durationSeconds}s / ${r.bonusPercent}% /${progStr}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
