/**
 * 活动综合力探究脚本
 *
 * 对邦/5v5/组曲活动时，auto PT 使用"活动综合力"。
 * 公式：普通综合力 + 活动加成（角色/属性/双中/成员卡/偏科/limitBreak）
 *
 * 测试目标：国服活动 314 (versus)，玩家 1006089883，目标综合力 270241
 *
 * 用法：npx tsx src/test/research-event-power.ts
 */

import { BESTDORI_API } from "@/config";
import { downloader } from "@/storage/downloader";
import type { AreaItemMeta } from "@/types/bestdori/area-item-meta";
import { calcAreaItemBonus } from "@/types/bestdori/area-item-meta";
import type { Stat } from "@/types/bestdori/stat";
import { addStat, emptyStat, statTotal } from "@/types/bestdori/stat";

// ============================================================================
// 参数
// ============================================================================

const PLAYER_ID = 28012549;
// const PLAYER_ID = 1006089883;
const SERVER = 0;
const SERVER_NAME = "jp";
const EVENT_ID = 333;
const TARGET_TOTAL = 0;

// ============================================================================
// API 响应类型
// ============================================================================

interface CardApiResponse {
    characterId: number;
    attribute: string;
    rarity: number;
    levelLimit: number;
    stat: Record<string, { performance: number; technique: number; visual: number }>;
}

interface PlayerEntryRaw {
    situationId: number;
    level: number;
    limitBreakRank: number;
    userAppendParameter: {
        performance: number;
        technique: number;
        visual: number;
        characterPotentialPerformance: number;
        characterPotentialTechnique: number;
        characterPotentialVisual: number;
        characterBonusPerformance?: number;
        characterBonusTechnique?: number;
        characterBonusVisual?: number;
    };
}

interface EventRaw {
    eventType: string;
    eventName: (string | null)[];
    attributes: Array<{ attribute: string; percent: number }>;
    characters: Array<{ characterId?: number; percent: number }>;
    members: Array<{ situationId?: number; percent: number }>;
    eventAttributeAndCharacterBonus?: { parameterPercent?: number; pointPercent?: number };
    eventCharacterParameterBonus?: { performance?: number; technique?: number; visual?: number };
    limitBreaks: Array<{ rarity: number; rank: number; percent: number }>;
}

// ============================================================================
// 计算
// ============================================================================

function calcBaseCardStat(meta: CardApiResponse, entry: PlayerEntryRaw): Stat {
    const base = meta.stat[String(entry.level)];
    if (!base) return emptyStat();
    const ap = entry.userAppendParameter;
    return {
        performance: base.performance + (ap.performance ?? 0) + (ap.characterPotentialPerformance ?? 0) + (ap.characterBonusPerformance ?? 0),
        technique: base.technique + (ap.technique ?? 0) + (ap.characterPotentialTechnique ?? 0) + (ap.characterBonusTechnique ?? 0),
        visual: base.visual + (ap.visual ?? 0) + (ap.characterPotentialVisual ?? 0) + (ap.characterBonusVisual ?? 0),
    };
}

function applyEventBonus(
    cardStat: Stat,
    cardChId: number,
    cardAttr: string,
    cardId: number,
    cardRarity: number,
    limitBreakRank: number,
    event: EventRaw,
): Stat {
    const bonus = emptyStat();
    const charMatch = event.characters.some((c) => c.characterId === cardChId);
    const attrMatch = event.attributes.some((a) => a.attribute === cardAttr);
    const memberMatch = event.members.some((m) => m.situationId === cardId);

    // 角色 / 属性 / 双中 / 成员卡
    for (const c of event.characters) {
        if (c.characterId === cardChId) {
            addStat(bonus, scalePct(cardStat, c.percent));
            break;
        }
    }
    for (const a of event.attributes) {
        if (a.attribute === cardAttr) {
            addStat(bonus, scalePct(cardStat, a.percent));
            break;
        }
    }
    const doubleBonus = event.eventAttributeAndCharacterBonus?.parameterPercent || event.eventAttributeAndCharacterBonus?.pointPercent || 0;
    if (charMatch && attrMatch && doubleBonus) {
        addStat(bonus, scalePct(cardStat, doubleBonus));
    }
    if (memberMatch) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) addStat(bonus, scalePct(cardStat, m.percent));
    }

    // limitBreak（按稀有度+突破次数给额外加成，对所有卡生效）
    const lb = event.limitBreaks.find((l) => l.rarity === cardRarity && l.rank === limitBreakRank);
    if (lb?.percent) addStat(bonus, scalePct(cardStat, lb.percent));

    // 偏科加成（需角色+属性同时命中才有）
    if (charMatch && attrMatch && event.eventCharacterParameterBonus) {
        const pb = event.eventCharacterParameterBonus;
        if (pb.performance) bonus.performance += (cardStat.performance * pb.performance) / 100;
        if (pb.technique) bonus.technique += (cardStat.technique * pb.technique) / 100;
        if (pb.visual) bonus.visual += (cardStat.visual * pb.visual) / 100;
    }

    return bonus;
}

function scalePct(stat: Stat, percent: number): Stat {
    return { performance: (stat.performance * percent) / 100, technique: (stat.technique * percent) / 100, visual: (stat.visual * percent) / 100 };
}

// ============================================================================
// 加载
// ============================================================================

async function loadEvent(eventId: number): Promise<EventRaw> {
    const url = new URL("events/all.5.json", BESTDORI_API).toString();
    const all = await downloader.download<Record<string, EventRaw>>(url);
    const e = all[String(eventId)];
    if (!e) throw new Error(`Event ${eventId} not found`);
    return e;
}

async function loadPlayer(playerId: number, serverName: string) {
    const url = new URL(`player/${serverName}/${playerId}?mode=2`, BESTDORI_API).toString();
    return downloader.download<{
        result: boolean;
        data?: {
            profile?: {
                userName: string;
                mainDeckUserSituations: { entries: PlayerEntryRaw[] };
                enabledUserAreaItems?: { entries: Array<{ areaItemCategory: number; level: number }> };
            };
        };
    }>(url);
}

async function loadCard(cardId: number): Promise<CardApiResponse> {
    return downloader.download<CardApiResponse>(new URL(`cards/${cardId}.json`, BESTDORI_API).toString());
}

interface AreaItemRaw {
    targetAttributes: string[];
    targetBandIds: number[];
    performance: Record<string, Array<number | null>>;
    technique: Record<string, Array<number | null>>;
    visual: Record<string, Array<number | null>>;
}

async function loadAreaItemMetas(): Promise<Map<number, AreaItemMeta>> {
    const map = new Map<number, AreaItemMeta>();
    const all = await downloader.download<Record<string, AreaItemRaw>>(new URL("areaItems/main.5.json", BESTDORI_API).toString());
    for (const [catStr, raw] of Object.entries(all)) {
        map.set(Number(catStr), {
            areaItemCategory: Number(catStr),
            targetAttributes: raw.targetAttributes as AreaItemMeta["targetAttributes"],
            targetBandIds: raw.targetBandIds,
            performance: raw.performance,
            technique: raw.technique,
            visual: raw.visual,
        });
    }
    return map;
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
    console.log("=".repeat(60));
    console.log(`活动综合力探究 — 活动 ${EVENT_ID} / 玩家 ${PLAYER_ID} (${SERVER_NAME}服)`);
    console.log(`目标值: ${TARGET_TOTAL}`);
    console.log("=".repeat(60));

    const [event, playerApi, areaItemMetaMap] = await Promise.all([loadEvent(EVENT_ID), loadPlayer(PLAYER_ID, SERVER_NAME), loadAreaItemMetas()]);

    console.log(`\n活动: ${event.eventName[3]} (type=${event.eventType})`);
    console.log(`属性: ${event.attributes.map((a) => `${a.attribute}+${a.percent}%`).join(", ")}`);
    console.log(`角色: ${event.characters.map((c) => `ch${c.characterId}+${c.percent}%`).join(", ")}`);
    const doubleDisplay = event.eventAttributeAndCharacterBonus?.parameterPercent || event.eventAttributeAndCharacterBonus?.pointPercent;
    if (doubleDisplay) console.log(`双中加成: ${doubleDisplay}%`);
    if (event.eventCharacterParameterBonus && Object.values(event.eventCharacterParameterBonus).some((v) => v))
        console.log(`偏科: ${JSON.stringify(event.eventCharacterParameterBonus)}`);
    console.log(`加成卡: ${event.members.map((m) => `card${m.situationId}+${m.percent}%`).join(", ")}`);
    console.log(
        `limitBreaks: r5lb4=${event.limitBreaks.find((l) => l.rarity === 5 && l.rank === 4)?.percent ?? 0}% r4lb4=${event.limitBreaks.find((l) => l.rarity === 4 && l.rank === 4)?.percent ?? 0}%`,
    );

    if (!playerApi.result || !playerApi.data?.profile) {
        console.error("\n玩家数据获取失败");
        process.exit(1);
    }
    const profile = playerApi.data.profile;
    console.log(`\n玩家: ${profile.userName}`);
    const entries = profile.mainDeckUserSituations?.entries ?? [];
    const areaItemEntries: Array<{ areaItemCategory: number; level: number }> = profile.enabledUserAreaItems?.entries ?? [];
    console.log(`编队 ${entries.length} 张卡, ${areaItemEntries.length} 个区域道具\n`);

    const baseTotal = emptyStat();
    const eventTotal = emptyStat();

    for (const entry of entries) {
        const cardMeta = await loadCard(entry.situationId);
        const bandId = Math.ceil(cardMeta.characterId / 5);
        const baseStat = calcBaseCardStat(cardMeta, entry);

        // 区域道具
        const areaBonus = emptyStat();
        for (const ai of areaItemEntries) {
            const am = areaItemMetaMap.get(ai.areaItemCategory);
            if (!am) continue;
            addStat(areaBonus, calcAreaItemBonus(am, ai.level, baseStat, cardMeta.attribute as "cool" | "happy" | "pure" | "powerful", bandId, SERVER));
        }

        const cardTotalStat: Stat = {
            performance: baseStat.performance + areaBonus.performance,
            technique: baseStat.technique + areaBonus.technique,
            visual: baseStat.visual + areaBonus.visual,
        };

        // 活动加成
        const eventBonus = applyEventBonus(baseStat, cardMeta.characterId, cardMeta.attribute, entry.situationId, cardMeta.rarity, entry.limitBreakRank, event);
        const cardEventStat: Stat = {
            performance: baseStat.performance + areaBonus.performance + eventBonus.performance,
            technique: baseStat.technique + areaBonus.technique + eventBonus.technique,
            visual: baseStat.visual + areaBonus.visual + eventBonus.visual,
        };

        addStat(baseTotal, baseStat);
        addStat(eventTotal, cardEventStat);

        const charMatch = event.characters.some((c) => c.characterId === cardMeta.characterId);
        const attrMatch = event.attributes.some((a) => a.attribute === cardMeta.attribute);
        const memberMatch = event.members.some((m) => m.situationId === entry.situationId);
        const tags: string[] = [];
        if (charMatch) tags.push("角色");
        if (attrMatch) tags.push("属性");
        if (charMatch && attrMatch) tags.push("双中");
        if (memberMatch) tags.push("加成卡");

        console.log(
            `Card ${entry.situationId} ch${cardMeta.characterId} r${cardMeta.rarity}lb${entry.limitBreakRank} ${cardMeta.attribute}: 普通=${statTotal(cardTotalStat).toFixed(0)} 活动=${statTotal(cardEventStat).toFixed(0)} (${tags.join("+") || "无加成"})`,
        );
    }

    const finalTotal = Math.floor(statTotal(eventTotal));
    console.log(`\n基础综合力: ${Math.floor(statTotal(baseTotal))}`);
    console.log(`活动综合力: ${finalTotal} (目标: ${TARGET_TOTAL})`);
    if (finalTotal === TARGET_TOTAL) console.log("✓ 匹配!");
    else console.log(`✗ 差值: ${finalTotal - TARGET_TOTAL}`);
}

main().catch((err) => {
    console.error("执行失败:", err);
    process.exit(1);
});
