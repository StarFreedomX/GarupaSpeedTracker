import { fetchBestdoriAreaItems, fetchBestdoriCardsBulk, fetchBestdoriCharacters, fetchBestdoriEventsFull, fetchBestdoriPlayer, fetchBestdoriSkills } from "@/api/bestdori";
import type { AreaItemMeta } from "@/types/bestdori/area-item-meta";
import { calcAreaItemBonus, getBandId, setBandIdMap } from "@/types/bestdori/area-item-meta";
import type { BestdoriEventFullRaw } from "@/types/bestdori/event";
import type { Stat } from "@/types/bestdori/stat";
import { addStat, emptyStat, statTotal } from "@/types/bestdori/stat";

// ============================================================================
// 类型
// ============================================================================

interface CardSkillInfo {
    bonusPercent: number;
    durationSeconds: number;
    progressive: { stepRate: number; maxCap: number } | null;
}

export interface PlayerDeckStatusResult {
    eventType: string;
    eventName: string;
    eventId: number | null;
    publishTotalDeckPowerFlg: boolean;
    normalPower: number;
    eventPower: number;
    autoPower: number;
    eventBonusPct: number;
    skills: CardSkillInfo[];
}

// ============================================================================
// 硬编码数据
// ============================================================================

const SERVER_NAMES = ["jp", "en", "tw", "cn", "kr"] as const;

const PROGRESSIVE_MAP: Record<number, { stepRate: number; maxCap: number }> = {
    61: { stepRate: 0.5, maxCap: 150 },
};

// ============================================================================
// 批量数据加载（缺 ID 时尝试刷新 / 单张回退）
// ============================================================================

type CardBulkMap = Record<string, Record<string, unknown>>;
type SkillBulkMap = Record<string, Record<string, unknown>>;

async function loadCardsWithFallback(cardIds: number[]): Promise<CardBulkMap> {
    // 先走缓存
    let cards = await fetchBestdoriCardsBulk();
    const missing = cardIds.filter((id) => !cards[String(id)]);

    if (missing.length > 0) {
        // 强制抓取并更新缓存
        cards = await fetchBestdoriCardsBulk({ forceUpdate: true });
    }

    return cards;
}

async function loadSkillsWithFallback(skillIds: number[]): Promise<SkillBulkMap> {
    let skills = await fetchBestdoriSkills();
    const missing = skillIds.filter((id) => !skills[String(id)]);

    if (missing.length > 0) {
        skills = await fetchBestdoriSkills({ forceUpdate: true });
    }

    return skills;
}

// ============================================================================
// 辅助函数
// ============================================================================

function scalePct(stat: Stat, percent: number): Stat {
    return { performance: (stat.performance * percent) / 100, technique: (stat.technique * percent) / 100, visual: (stat.visual * percent) / 100 };
}

function getAtIndex(arr: (number | null)[], index: number): number | null {
    return arr[index] ?? null;
}

// ============================================================================
// 普通综合力
// ============================================================================

function calcBaseStat(cardStatRaw: Record<string, unknown>, entry: { level: number; userAppendParameter?: Record<string, number> }): Stat {
    const stat = cardStatRaw.stat as Record<string, { performance: number; technique: number; visual: number }> | undefined;
    const base = stat?.[String(entry.level)];
    if (!base) return emptyStat();
    const ap = entry.userAppendParameter ?? {};
    return {
        performance: base.performance + (ap.performance ?? 0) + (ap.characterPotentialPerformance ?? 0) + (ap.characterBonusPerformance ?? 0),
        technique: base.technique + (ap.technique ?? 0) + (ap.characterPotentialTechnique ?? 0) + (ap.characterBonusTechnique ?? 0),
        visual: base.visual + (ap.visual ?? 0) + (ap.characterPotentialVisual ?? 0) + (ap.characterBonusVisual ?? 0),
    };
}

// ============================================================================
// 活动加成
// ============================================================================

function calcCardEventBonus(baseStat: Stat, chId: number, attr: string, cardId: number, rarity: number, lbRank: number, event: BestdoriEventFullRaw): Stat {
    const bonus = emptyStat();
    const charMatch = event.characters.some((c) => c.characterId === chId);
    const attrMatch = event.attributes.some((a) => a.attribute === attr);
    const memberMatch = event.members.some((m) => m.situationId === cardId);

    for (const c of event.characters) {
        if (c.characterId === chId) {
            addStat(bonus, scalePct(baseStat, c.percent));
            break;
        }
    }
    for (const a of event.attributes) {
        if (a.attribute === attr) {
            addStat(bonus, scalePct(baseStat, a.percent));
            break;
        }
    }
    const doubleBonus = event.eventAttributeAndCharacterBonus?.parameterPercent ?? 0;
    if (charMatch && attrMatch && doubleBonus) addStat(bonus, scalePct(baseStat, doubleBonus));
    if (memberMatch) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) addStat(bonus, scalePct(baseStat, m.percent));
    }
    const lb = event.limitBreaks.find((l) => l.rarity === rarity && l.rank === lbRank);
    if (lb?.percent) addStat(bonus, scalePct(baseStat, lb.percent));
    if (charMatch && attrMatch && event.eventCharacterParameterBonus) {
        const pb = event.eventCharacterParameterBonus;
        if (pb.performance) bonus.performance += (baseStat.performance * pb.performance) / 100;
        if (pb.technique) bonus.technique += (baseStat.technique * pb.technique) / 100;
        if (pb.visual) bonus.visual += (baseStat.visual * pb.visual) / 100;
    }
    return bonus;
}

function calcCardBonusPct(
    chId: number,
    attr: string,
    cardId: number,
    rarity: number,
    lbRank: number,
    event: BestdoriEventFullRaw,
): { totalPct: number; hasCharAttr: boolean } {
    let pct = 0;
    let hasChar = false;
    let hasAttr = false;
    for (const c of event.characters) {
        if (c.characterId === chId) {
            pct += c.percent;
            hasChar = true;
            break;
        }
    }
    for (const a of event.attributes) {
        if (a.attribute === attr) {
            pct += a.percent;
            hasAttr = true;
            break;
        }
    }
    const isEventPowerType = event.eventType === "versus" || event.eventType === "festival" || event.eventType === "medley";
    const doublePct = isEventPowerType
        ? (event.eventAttributeAndCharacterBonus?.parameterPercent ?? 0)
        : (event.eventAttributeAndCharacterBonus?.pointPercent ?? 0);
    if (hasChar && hasAttr && doublePct) pct += doublePct;
    if (event.members.some((m) => m.situationId === cardId)) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) pct += m.percent;
    }
    const lb = event.limitBreaks.find((l) => l.rarity === rarity && l.rank === lbRank);
    if (lb?.percent) pct += lb.percent;
    return { totalPct: pct, hasCharAttr: hasChar && hasAttr };
}

// ============================================================================
// 技能
// ============================================================================

/** 用于技能统一加成判定的卡片摘要 */
interface CardBrief {
    bandId: number;
    attribute: string;
}

const SCORING_TYPES = ["score", "score_only_perfect", "score_over_life", "score_under_life", "score_continued_note_judge", "score_under_great_half"] as const;

function isGameplayCondition(condition: string): boolean {
    return condition === "perfect" || condition === "great" || condition === "good" || condition === "bad";
}

function isLifeCondition(conditionLife: number | undefined): boolean {
    return conditionLife != null && conditionLife > 0;
}

function calcSkill(card: { skillId: number; skillLevel: number }, skillsRaw: SkillBulkMap, server: number, allCards: CardBrief[]): CardSkillInfo {
    const skill = skillsRaw[String(card.skillId)];
    if (!skill) return { bonusPercent: 0, durationSeconds: 0, progressive: null };

    const levelIndex = card.skillLevel - 1;
    const serverIndex = Math.min(server, 4);
    const ae = skill.activationEffect as Record<string, unknown> | undefined;
    const effectTypes = (ae?.activateEffectTypes ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const progressive = PROGRESSIVE_MAP[card.skillId] ?? null;

    // 遍历计分效果，取最高倍率
    // 条件判定：游戏内判定条件（PERFECT/GREAT/LIFE 阈值等）默认全满足
    let bestBonus = 0;
    for (const type of SCORING_TYPES) {
        const eff = effectTypes[type];
        if (!eff) continue;

        const rawValue = getAtIndex(eff.activateEffectValue as (number | null)[], serverIndex);
        if (rawValue == null) continue;

        // 检查条件是否可触发（游戏内判定 / 血量条件 / 无条件的均视为适用）
        const condition = (eff.activateCondition as string | undefined) ?? "good";
        const conditionLife = eff.activateConditionLife as number | undefined;
        const isApplicable = condition === "none" || isGameplayCondition(condition) || isLifeCondition(conditionLife);

        if (isApplicable && rawValue > bestBonus) {
            bestBonus = rawValue;
        }
    }

    // 统一加成（unification）：当整队满足特定条件时触发更高倍率
    // 例如：skill 74 的 "编队仅有 Poppin'Party 时 155%UP"（否则 145%）
    const unificationValue = ae?.unificationActivateEffectValue as number | undefined;
    if (unificationValue != null && unificationValue > bestBonus) {
        const bandId = ae?.unificationActivateConditionBandId as number | undefined;
        const attrType = ae?.unificationActivateConditionType as string | undefined;

        // 条件检查：bandId 和 attrType 可同时存在，此时需同时满足
        let satisfied = bandId != null || attrType != null;
        if (bandId != null && !allCards.every((c) => c.bandId === bandId)) {
            satisfied = false;
        }
        if (attrType != null && !allCards.every((c) => c.attribute.toUpperCase() === attrType.toUpperCase())) {
            satisfied = false;
        }

        if (satisfied) {
            bestBonus = unificationValue;
        }
    }

    const durationArr = (skill.duration ?? []) as number[];
    const duration = getAtIndex(durationArr, levelIndex) ?? 0;

    return { bonusPercent: bestBonus, durationSeconds: duration, progressive };
}

// ============================================================================
// 主服务
// ============================================================================

export const playerDeckService = {
    async getPlayerDeckStatus(server: number, playerId: number, eventId?: number | null): Promise<PlayerDeckStatusResult> {
        const serverName = SERVER_NAMES[server] ?? "jp";

        // 并行加载基础数据
        const [eventsFull, playerApi] = await Promise.all([fetchBestdoriEventsFull(), fetchBestdoriPlayer(serverName, playerId)]);

        const profile = (playerApi.data?.profile ?? {}) as Record<string, unknown>;
        const publishTotalDeckPowerFlg = (profile.publishTotalDeckPowerFlg as boolean) ?? false;
        const entries = (profile.mainDeckUserSituations as { entries: Array<Record<string, unknown>> } | undefined)?.entries ?? [];
        const areaItemEntries = (profile.enabledUserAreaItems as { entries: Array<{ areaItemCategory: number; level: number }> } | undefined)?.entries ?? [];

        if (entries.length === 0) throw new Error("Player deck is empty");

        // 确定活动
        const resolvedEventId = eventId && eventId > 0 ? eventId : getPresentEvent(eventsFull, server);
        const event = resolvedEventId ? eventsFull[String(resolvedEventId)] : null;

        // 收集需要的 card ID 和 skill ID
        const cardIds: number[] = [];
        const playerCards: Array<{
            situationId: number;
            level: number;
            limitBreakRank: number;
            skillLevel: number;
            userAppendParameter?: Record<string, number>;
        }> = [];
        for (const entry of entries) {
            const sid = entry.situationId as number;
            cardIds.push(sid);
            playerCards.push({
                situationId: sid,
                level: entry.level as number,
                limitBreakRank: (entry.limitBreakRank as number) ?? 0,
                skillLevel: (entry.skillLevel as number) ?? 1,
                userAppendParameter: entry.userAppendParameter as Record<string, number> | undefined,
            });
        }

        // 批量加载卡牌、区域道具、角色映射（并行）
        const [cardsBulk, areaItemsRaw, charactersRaw] = await Promise.all([loadCardsWithFallback(cardIds), fetchBestdoriAreaItems(), fetchBestdoriCharacters()]);

        // 初始化角色→乐队映射（确保 bandId 与 Bestdori 的 targetBandIds 一致）
        setBandIdMap(charactersRaw);

        // 收集需要的 skill ID，批量加载技能
        const skillIds = cardIds
            .map((id) => {
                const c = cardsBulk[String(id)];
                return c ? (c.skillId as number) : 0;
            })
            .filter((s) => s > 0);
        const skillsRaw = await loadSkillsWithFallback(skillIds);

        // 构建整队卡片摘要（用于技能统一加成判定）
        const allCardBriefs: CardBrief[] = cardIds.map((id) => {
            const c = cardsBulk[String(id)];
            if (!c) return { bandId: 0, attribute: "" };
            const chId = c.characterId as number;
            return {
                bandId: getBandId(chId),
                attribute: (c.attribute as string) ?? "",
            };
        });

        // 区域道具 map
        const areaItemMetaMap = new Map<number, AreaItemMeta>();
        for (const [catStr, raw] of Object.entries(areaItemsRaw)) {
            const r = raw as Record<string, unknown>;
            areaItemMetaMap.set(Number(catStr), {
                areaItemCategory: Number(catStr),
                targetAttributes: (r.targetAttributes ?? []) as AreaItemMeta["targetAttributes"],
                targetBandIds: (r.targetBandIds ?? []) as number[],
                performance: (r.performance ?? {}) as Record<string, Array<number | null>>,
                technique: (r.technique ?? {}) as Record<string, Array<number | null>>,
                visual: (r.visual ?? {}) as Record<string, Array<number | null>>,
            });
        }

        // 处理每张卡
        let normalPower = 0;
        let eventPower = 0;
        let autoPower = 0;
        let totalBonusPct = 0;
        const skills: CardSkillInfo[] = [];

        for (const pc of playerCards) {
            const cardRaw = cardsBulk[String(pc.situationId)];
            if (!cardRaw) {
                // 批量+刷新+单张回退都失败 → 跳过
                skills.push({ bonusPercent: 0, durationSeconds: 0, progressive: null });
                continue;
            }

            const chId = cardRaw.characterId as number;
            const attr = cardRaw.attribute as string;
            const rarity = cardRaw.rarity as number;
            const bandId = getBandId(chId);

            const baseStat = calcBaseStat(cardRaw, pc);

            // 区域道具
            const areaBonus = emptyStat();
            for (const ai of areaItemEntries) {
                const am = areaItemMetaMap.get(ai.areaItemCategory);
                if (!am) continue;
                addStat(areaBonus, calcAreaItemBonus(am, ai.level, baseStat, attr as "cool" | "happy" | "pure" | "powerful", bandId, server));
            }

            const cardNormal = statTotal(baseStat) + statTotal(areaBonus);
            normalPower += cardNormal;

            // 活动加成
            if (event) {
                const eventBonus = calcCardEventBonus(baseStat, chId, attr, pc.situationId, rarity, pc.limitBreakRank, event);
                const { totalPct, hasCharAttr } = calcCardBonusPct(chId, attr, pc.situationId, rarity, pc.limitBreakRank, event);
                const pbPct =
                    hasCharAttr && event.eventCharacterParameterBonus
                        ? (event.eventCharacterParameterBonus.performance ?? 0) +
                          (event.eventCharacterParameterBonus.technique ?? 0) +
                          (event.eventCharacterParameterBonus.visual ?? 0)
                        : 0;
                totalBonusPct += totalPct + pbPct;

                if (event.eventType === "versus" || event.eventType === "festival" || event.eventType === "medley") {
                    eventPower += cardNormal + statTotal(eventBonus);
                    autoPower = eventPower;
                } else if (event.eventType === "challenge") {
                    eventPower += cardNormal + statTotal(eventBonus);
                    autoPower += cardNormal;
                } else {
                    eventPower += cardNormal;
                    autoPower += cardNormal;
                }
            } else {
                eventPower += cardNormal;
                autoPower += cardNormal;
            }

            // 技能
            skills.push(calcSkill({ skillId: cardRaw.skillId as number, skillLevel: pc.skillLevel }, skillsRaw, server, allCardBriefs));
        }

        if (!event && autoPower === 0) eventPower = normalPower;

        // 技能重排序：后端按 leader→member1-4 排列，前端 UI 从上到下为 member3→member1→leader→member2→member4
        const UI_SKILL_ORDER = [3, 1, 0, 2, 4];
        const reorderedSkills = skills.length === UI_SKILL_ORDER.length ? UI_SKILL_ORDER.map((i) => skills[i]) : skills;

        return {
            eventType: event?.eventType ?? "none",
            eventName: (event?.eventName?.[server] ?? event?.eventName?.[0] ?? "") as string,
            eventId: resolvedEventId,
            publishTotalDeckPowerFlg,
            normalPower: Math.floor(normalPower),
            eventPower: Math.floor(eventPower),
            autoPower: Math.floor(autoPower),
            eventBonusPct: Math.round(totalBonusPct),
            skills: reorderedSkills,
        };
    },
};

// ============================================================================
// getPresentEvent
// ============================================================================

function getPresentEvent(events: Record<string, BestdoriEventFullRaw>, server: number, time?: number): number | null {
    const now = time ?? Date.now();
    const eventIds = Object.keys(events).map(Number);
    const ongoing = eventIds.filter((id) => {
        const e = events[String(id)];
        if (!e?.startAt?.[server] || !e?.endAt?.[server]) return false;
        const startAt = e.startAt[server];
        const endAt = e.endAt[server];
        if (startAt == null || endAt == null) return false;
        const start = new Date(Number(startAt)).getTime();
        const end = new Date(Number(endAt)).getTime();
        return start - 86400000 <= now && end >= now;
    });

    if (ongoing.length > 0) return ongoing.sort((a, b) => b - a)[ongoing.length - 1];

    const withStart = eventIds.filter((id) => events[String(id)]?.startAt?.[server] != null);
    if (withStart.length === 0) return null;

    withStart.sort((a, b) => {
        const saStr = events[String(a)]?.startAt?.[server];
        const sbStr = events[String(b)]?.startAt?.[server];
        const sa = saStr != null ? new Date(Number(saStr)).getTime() : 0;
        const sb = sbStr != null ? new Date(Number(sbStr)).getTime() : 0;
        return Math.abs(sa - now) - Math.abs(sb - now);
    });

    return withStart[0] ?? null;
}
