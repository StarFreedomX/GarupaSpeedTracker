// noinspection DuplicatedCode
/**
 * 技能信息探究脚本
 *
 * 动态获取玩家的主编队卡牌，逐一分析技能。
 * 输出结构：{ durationSeconds, bonusPercent, progressive: { stepRate, maxCap } | null }
 *
 * 规则：
 *   1. 步进式（score_rate_up_with_perfect）→ 同时返回 base 和 progressive
 *   2. 游戏内判定条件（PERFECT/GREAT/LIFE 阈值等）→ 默认全满足，取最高加成
 *   3. 静态编队条件（bandId / attribute）→ 整队全部匹配才生效
 *   4. 两者叠加时分别判断
 *
 * 用法：
 *   npx tsx src/test/research-skill-info.ts                          # 默认：日服 28012549
 *   npx tsx src/test/research-skill-info.ts 28012549 0              # 指定玩家ID和服务器
 */

import { BESTDORI_API } from "@/config";
import { downloader } from "@/storage/downloader";
import { getBandId } from "@/types/bestdori/area-item-meta";

// ============================================================================
// 类型定义
// ============================================================================

type Attribute = "cool" | "happy" | "pure" | "powerful";
type ActivateCondition = "none" | "bad" | "good" | "great" | "perfect";

interface SkillEffectValue {
    activateEffectValue: (number | null)[];
    activateEffectValueType: "rate" | "real_value";
    activateCondition: ActivateCondition;
    activateConditionLife?: number;
}

interface SkillRaw {
    simpleDescription: (string | null)[];
    description: (string | null)[];
    duration: number[];
    activationEffect: {
        activateEffectTypes: Record<string, SkillEffectValue | undefined>;
        unificationActivateEffectValue?: number;
        unificationActivateConditionBandId?: number;
        unificationActivateConditionType?: string;
    };
}

// ============================================================================
// API 响应类型
// ============================================================================

interface PlayerCardEntryRaw {
    situationId: number;
    level: number;
    skillLevel: number;
}

interface PlayerApiResponse {
    result: boolean;
    data?: {
        profile?: {
            publishTotalDeckPowerFlg: boolean;
            userName: string;
            mainDeckUserSituations: { entries: PlayerCardEntryRaw[] };
        };
    };
}

interface CardApiResponse {
    characterId: number;
    attribute: string;
    skillId: number;
}

// ============================================================================
// 输出结构
// ============================================================================

interface ProgressiveInfo {
    /** 每次 PERFECT 增加的百分比 */
    stepRate: number;
    /** 最大上限百分比 */
    maxCap: number;
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
    /** 秒 */
    durationSeconds: number;
    /** 固定倍率 % */
    bonusPercent: number;
    /** 步进式加成；无则为 null */
    progressive: ProgressiveInfo | null;
    /** 调试：各激活效果 */
    effects: Array<{
        type: string;
        rawValue: number | null;
        condition: string;
        conditionLife?: number;
        isApplicable: boolean;
    }>;
    /** 调试：统一加成 */
    unification?: {
        conditionType: string | undefined;
        conditionBandId: number | undefined;
        value: number | undefined;
        isSatisfied: boolean;
    };
}

// ============================================================================
// 数据加载
// ============================================================================

const SERVER_NAMES = ["jp", "en", "tw", "cn", "kr"] as const;

async function loadSkills(): Promise<Record<string, SkillRaw>> {
    const url = new URL("skills/all.10.json", BESTDORI_API).toString();
    console.log(`[load] 技能数据: ${url}`);
    return downloader.download<Record<string, SkillRaw>>(url);
}

async function loadPlayer(playerId: number, server: number): Promise<PlayerApiResponse> {
    const serverName = SERVER_NAMES[server] ?? "jp";
    const url = new URL(`player/${serverName}/${playerId}?mode=2`, BESTDORI_API).toString();
    console.log(`[load] 玩家数据: ${url}`);
    return downloader.download<PlayerApiResponse>(url);
}

async function loadCardMeta(cardId: number): Promise<CardApiResponse> {
    const url = new URL(`cards/${cardId}.json`, BESTDORI_API).toString();
    return downloader.download<CardApiResponse>(url);
}

// ============================================================================
// 工具函数
// ============================================================================

function getAtIndex(arr: (number | null)[], index: number): number | null {
    return arr[index] ?? null;
}

function isGameplayCondition(condition: string): boolean {
    return condition === "perfect" || condition === "great" || condition === "good" || condition === "bad";
}

function isLifeCondition(conditionLife: number | undefined): boolean {
    return conditionLife != null && conditionLife > 0;
}

function isUnificationSatisfied(allCards: CardBrief[], skill: SkillRaw): boolean {
    const ae = skill.activationEffect;
    const bandId = ae.unificationActivateConditionBandId;
    const attrType = ae.unificationActivateConditionType;

    if (bandId != null && !allCards.every((c) => c.bandId === bandId)) return false;
    if (attrType != null && !allCards.every((c) => c.attribute.toUpperCase() === attrType?.toUpperCase())) return false;

    return bandId != null || attrType != null;
}

// ============================================================================
// 步进式技能参数（skillId=61 是目前唯一的步进技能）
// ============================================================================

/** skillId → 步进参数（硬编码，避免字符串解析） */
const PROGRESSIVE_MAP: Record<number, ProgressiveInfo> = {
    61: { stepRate: 0.5, maxCap: 150 },
};

// ============================================================================
// 核心分析
// ============================================================================

const SCORING_TYPES = ["score", "score_only_perfect", "score_over_life", "score_under_life", "score_continued_note_judge", "score_under_great_half"];

function analyzeSkill(card: CardBrief, skill: SkillRaw, server: number, allCards: CardBrief[]): SkillResult {
    const levelIndex = card.skillLevel - 1;
    const serverIndex = Math.min(server, 4);
    const ae = skill.activationEffect;
    const effectTypes = ae.activateEffectTypes;

    // ── 步进式打法（仅 skillId=61）──
    const progressive = PROGRESSIVE_MAP[card.skillId] ?? null;

    // ── 遍历计分效果，取最高倍率 ──
    let bestBonus = 0;
    const effects: SkillResult["effects"] = [];

    for (const type of SCORING_TYPES) {
        const eff = effectTypes[type];
        if (!eff) continue;

        const rawValue = getAtIndex(eff.activateEffectValue, serverIndex);
        const condition = eff.activateCondition ?? "good";
        const hasGameplayCond = isGameplayCondition(condition);
        const hasLifeCond = isLifeCondition(eff.activateConditionLife);
        const isApplicable = condition === "none" || hasGameplayCond || hasLifeCond;

        effects.push({ type, rawValue, condition, conditionLife: eff.activateConditionLife, isApplicable });

        if (isApplicable && rawValue != null && rawValue > bestBonus) {
            bestBonus = rawValue;
        }
    }

    // ── 统一加成 ──
    let unification: SkillResult["unification"] | undefined;
    if (ae.unificationActivateEffectValue != null) {
        const isSatisfied = isUnificationSatisfied(allCards, skill);
        unification = {
            conditionType: ae.unificationActivateConditionType,
            conditionBandId: ae.unificationActivateConditionBandId,
            value: ae.unificationActivateEffectValue,
            isSatisfied,
        };
        if (isSatisfied && ae.unificationActivateEffectValue > bestBonus) {
            bestBonus = ae.unificationActivateEffectValue;
        }
    }

    const duration = getAtIndex(skill.duration, levelIndex) ?? 0;

    return {
        cardId: card.cardId,
        skillId: card.skillId,
        skillLevel: card.skillLevel,
        durationSeconds: duration,
        bonusPercent: bestBonus,
        progressive,
        effects,
        unification,
    };
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
    console.log(`技能信息探究 — 玩家 ${playerId} (${serverName}服 server=${server})`);
    console.log("=".repeat(60));

    const [skills, playerApi] = await Promise.all([loadSkills(), loadPlayer(playerId, server)]);
    console.log(`[load] 技能 ${Object.keys(skills).length} 个\n`);

    if (!playerApi.result || !playerApi.data?.profile) {
        console.error("玩家数据获取失败");
        process.exit(1);
    }

    const profile = playerApi.data.profile;
    console.log(`玩家: ${profile.userName}`);

    const entries = profile.mainDeckUserSituations?.entries ?? [];
    if (entries.length === 0) {
        console.log("主编队为空");
        process.exit(0);
    }

    console.log(`主编队 ${entries.length} 张卡，正在加载卡片元数据...\n`);

    const cardBriefs: CardBrief[] = [];
    for (const entry of entries) {
        const cardMeta = await loadCardMeta(entry.situationId);
        cardBriefs.push({
            cardId: entry.situationId,
            characterId: cardMeta.characterId,
            bandId: getBandId(cardMeta.characterId),
            attribute: cardMeta.attribute as Attribute,
            skillId: cardMeta.skillId,
            skillLevel: entry.skillLevel,
        });
    }

    for (const card of cardBriefs) {
        const skill = skills[String(card.skillId)];
        if (!skill) {
            console.log(`Card ${card.cardId}: skillId=${card.skillId} — 技能数据未找到`);
            continue;
        }

        const result = analyzeSkill(card, skill, server, cardBriefs);

        // ── 输出 ──
        const progStr = result.progressive ? `{ stepRate: ${result.progressive.stepRate}%, maxCap: ${result.progressive.maxCap}% }` : "null";

        console.log(`Card ${result.cardId} (ch${card.characterId} band${card.bandId} ${card.attribute}) skillId=${result.skillId} Lv${result.skillLevel}`);
        console.log(`  → ${result.durationSeconds}s / ${result.bonusPercent}% / ${progStr}`);
        console.log(`  desc: ${skill.description[0]?.replace(/\n/g, " ")}`);
        console.log(
            `  effects: ${
                result.effects
                    .filter((e) => e.isApplicable)
                    .map((e) => `${e.type}=${e.rawValue}%`)
                    .join(", ") || "(none)"
            }`,
        );
        if (result.unification) {
            const u = result.unification;
            console.log(`  unification: ${u.value}% ${u.isSatisfied ? "✓" : "✗"} (bandId=${u.conditionBandId ?? "-"} type=${u.conditionType ?? "-"})`);
        }
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
        const progStr = r.progressive ? ` | progressive: ${r.progressive.stepRate}%→${r.progressive.maxCap}%` : "";
        console.log(
            `Card ${r.cardId}: ${r.durationSeconds}s / ${r.bonusPercent}% / ${r.progressive ? `{${r.progressive.stepRate}, ${r.progressive.maxCap}}` : "null"}${progStr}`,
        );
    }
}

main().catch((err) => {
    console.error("执行失败:", err);
    process.exit(1);
});
