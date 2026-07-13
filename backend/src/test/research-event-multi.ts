// noinspection DuplicatedCode

/**
 * 多活动综合力探究脚本
 *
 * 按活动类型区分：
 *   - versus / festival：活动综合力 = 普通综合力 + 活动加成（各卡加成应用到三围）
 *   - story / challenge / mission_live / live_try：活动综合力 = 普通综合力，活动加成 = 各卡加成%之和
 *   - medley：跳过（编队独立，无法通过 player API 查询）
 *
 * 用法：
 *   npx tsx src/test/research-event-multi.ts                            # 默认玩家 + 全部活动
 *   npx tsx src/test/research-event-multi.ts 28012549 0 330 340        # 指定活动范围
 */

import { BESTDORI_API } from "@/config";
import { downloader } from "@/storage/downloader";
import type { AreaItemMeta } from "@/types/bestdori/area-item-meta";
import { calcAreaItemBonus, getBandId } from "@/types/bestdori/area-item-meta";
import type { Stat } from "@/types/bestdori/stat";
import { addStat, emptyStat, statTotal } from "@/types/bestdori/stat";

// ============================================================================
// 参数
// ============================================================================

const PLAYER_ID = Number(process.argv[2]) || 28012549;
const SERVER = Number(process.argv[3]) || 0;
const SERVER_NAMES = ["jp", "en", "tw", "cn", "kr"] as const;
const SERVER_NAME = SERVER_NAMES[SERVER] ?? "jp";
const EVENT_ID_START = Number(process.argv[4]) || 1;
const EVENT_ID_END = Number(process.argv[5]) || 500;

// ============================================================================
// 类型
// ============================================================================

interface CardMetaRaw {
    characterId: number;
    attribute: string;
    rarity: number;
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

interface AreaItemRaw {
    targetAttributes: string[];
    targetBandIds: number[];
    performance: Record<string, Array<number | null>>;
    technique: Record<string, Array<number | null>>;
    visual: Record<string, Array<number | null>>;
}

interface CardInfo {
    cardId: number;
    characterId: number;
    bandId: number;
    attribute: string;
    rarity: number;
    limitBreakRank: number;
    baseStat: Stat;
    areaBonus: Stat;
    normalPower: number;
}

interface EventResult {
    eventId: number;
    eventType: string;
    eventName: string;
    normalPower: number;
    eventPower: number;
    autoPower: number;
    eventBonusPct: number;
    eventBonusStat: Stat;
    skipped: boolean;
    reason?: string;
}

// ============================================================================
// 计算
// ============================================================================

function calcBaseStat(meta: CardMetaRaw, entry: PlayerEntryRaw): Stat {
    const base = meta.stat[String(entry.level)];
    if (!base) return emptyStat();
    const ap = entry.userAppendParameter;
    return {
        performance: base.performance + (ap.performance ?? 0) + (ap.characterPotentialPerformance ?? 0) + (ap.characterBonusPerformance ?? 0),
        technique: base.technique + (ap.technique ?? 0) + (ap.characterPotentialTechnique ?? 0) + (ap.characterBonusTechnique ?? 0),
        visual: base.visual + (ap.visual ?? 0) + (ap.characterPotentialVisual ?? 0) + (ap.characterBonusVisual ?? 0),
    };
}

function scalePct(stat: Stat, percent: number): Stat {
    return { performance: (stat.performance * percent) / 100, technique: (stat.technique * percent) / 100, visual: (stat.visual * percent) / 100 };
}

/** 计算单卡的活动加成%总和（所有百分比角色+属性+双中+成员+limitBreak直接加） */
function calcCardBonusPct(
    chId: number,
    attr: string,
    cardId: number,
    rarity: number,
    lbRank: number,
    event: EventRaw,
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
    // 双中加成：versus/festival/medley 用 parameterPercent，其余用 pointPercent
    const isEventPowerType = event.eventType === "versus" || event.eventType === "festival" || event.eventType === "medley";
    const doublePct = isEventPowerType
        ? (event.eventAttributeAndCharacterBonus?.parameterPercent ?? 0)
        : (event.eventAttributeAndCharacterBonus?.pointPercent ?? 0);
    if (hasChar && hasAttr && doublePct) {
        pct += doublePct;
    }
    if (event.members.some((m) => m.situationId === cardId)) {
        const m = event.members.find((x) => x.situationId === cardId);
        if (m) pct += m.percent;
    }
    const lb = event.limitBreaks.find((l) => l.rarity === rarity && l.rank === lbRank);
    if (lb?.percent) pct += lb.percent;

    return { totalPct: pct, hasCharAttr: hasChar && hasAttr };
}

/** 计算单卡活动加成（应用到三围），仅 versus/festival 使用 */
function calcCardEventBonus(baseStat: Stat, chId: number, attr: string, cardId: number, rarity: number, lbRank: number, event: EventRaw): Stat {
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
    if (charMatch && attrMatch && doubleBonus) {
        addStat(bonus, scalePct(baseStat, doubleBonus));
    }
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

// ============================================================================
// 加载
// ============================================================================

async function loadEvents(): Promise<Record<string, EventRaw>> {
    return downloader.download<Record<string, EventRaw>>(new URL("events/all.5.json", BESTDORI_API).toString());
}

async function loadPlayer() {
    const url = new URL(`player/${SERVER_NAME}/${PLAYER_ID}?mode=2`, BESTDORI_API).toString();
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

async function loadCardMeta(cardId: number): Promise<CardMetaRaw> {
    return downloader.download<CardMetaRaw>(new URL(`cards/${cardId}.json`, BESTDORI_API).toString());
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

/** 无跳过类型（组曲也按对邦算法计算） */

async function main() {
    console.log(`加载玩家 ${PLAYER_ID} (${SERVER_NAME}服) 与全部活动数据...`);
    const [events, playerApi, areaItemMetaMap] = await Promise.all([loadEvents(), loadPlayer(), loadAreaItemMetas()]);

    if (!playerApi.result || !playerApi.data?.profile) {
        console.error("玩家数据获取失败");
        process.exit(1);
    }

    const profile = playerApi.data.profile;
    console.log(`玩家: ${profile.userName}`);

    const entries = profile.mainDeckUserSituations?.entries ?? [];
    const areaItemEntries: Array<{ areaItemCategory: number; level: number }> = profile.enabledUserAreaItems?.entries ?? [];

    if (entries.length === 0) {
        console.log("编队为空");
        process.exit(0);
    }

    // 加载所有卡牌元数据，构建 CardInfo
    console.log(`加载 ${entries.length} 张卡元数据...`);
    const cards: CardInfo[] = [];
    for (const entry of entries) {
        const meta = await loadCardMeta(entry.situationId);
        const bandId = getBandId(meta.characterId);
        const baseStat = calcBaseStat(meta, entry);

        // 区域道具
        const areaBonus = emptyStat();
        for (const ai of areaItemEntries) {
            const am = areaItemMetaMap.get(ai.areaItemCategory);
            if (!am) continue;
            addStat(areaBonus, calcAreaItemBonus(am, ai.level, baseStat, meta.attribute as "cool" | "happy" | "pure" | "powerful", bandId, SERVER));
        }

        cards.push({
            cardId: entry.situationId,
            characterId: meta.characterId,
            bandId,
            attribute: meta.attribute,
            rarity: meta.rarity,
            limitBreakRank: entry.limitBreakRank,
            baseStat,
            areaBonus,
            normalPower: statTotal(baseStat) + statTotal(areaBonus),
        });
    }

    // 普通综合力
    const normalPower = cards.reduce((s, c) => s + c.normalPower, 0);

    // 过滤要处理的活动
    const eventIds = Object.keys(events)
        .map(Number)
        .filter((id) => id >= EVENT_ID_START && id <= EVENT_ID_END)
        .sort((a, b) => a - b);

    console.log(`\n处理 ${eventIds.length} 个活动 (${EVENT_ID_START}-${EVENT_ID_END})...\n`);
    console.log("eventId | eventType        | eventName              | 普通综合力 | 活动综合力 | auto综合力 | 活动加成%");
    console.log("-".repeat(108));

    const results: EventResult[] = [];

    for (const eventId of eventIds) {
        const event = events[String(eventId)];
        if (!event) continue;

        const eventName = event.eventName[SERVER] ?? event.eventName[0] ?? "?";
        const eventType = event.eventType;

        // 计算活动加成
        let totalBonusPct = 0;
        let eventPower = normalPower;
        let autoPower = normalPower;
        const eventBonusStat = emptyStat();

        if (eventType === "versus" || eventType === "festival" || eventType === "medley") {
            // 对邦/5v5：auto 使用活动综合力
            for (const card of cards) {
                const bonus = calcCardEventBonus(card.baseStat, card.characterId, card.attribute, card.cardId, card.rarity, card.limitBreakRank, event);
                addStat(eventBonusStat, bonus);
                const { totalPct } = calcCardBonusPct(card.characterId, card.attribute, card.cardId, card.rarity, card.limitBreakRank, event);
                totalBonusPct += totalPct;
            }
            eventPower = normalPower + statTotal(eventBonusStat);
            autoPower = eventPower;
        } else if (eventType === "challenge") {
            // 挑战LIVE：活动综合力按对邦算法算，但 auto 用普通综合力
            for (const card of cards) {
                const bonus = calcCardEventBonus(card.baseStat, card.characterId, card.attribute, card.cardId, card.rarity, card.limitBreakRank, event);
                addStat(eventBonusStat, bonus);
                const { totalPct } = calcCardBonusPct(card.characterId, card.attribute, card.cardId, card.rarity, card.limitBreakRank, event);
                totalBonusPct += totalPct;
            }
            eventPower = normalPower + statTotal(eventBonusStat);
        } else {
            // story / mission_live / live_try：只算加成%
            for (const card of cards) {
                const { totalPct, hasCharAttr } = calcCardBonusPct(card.characterId, card.attribute, card.cardId, card.rarity, card.limitBreakRank, event);
                const pbPct =
                    hasCharAttr && event.eventCharacterParameterBonus
                        ? (event.eventCharacterParameterBonus.performance ?? 0) +
                          (event.eventCharacterParameterBonus.technique ?? 0) +
                          (event.eventCharacterParameterBonus.visual ?? 0)
                        : 0;
                totalBonusPct += totalPct + pbPct;
            }
        }

        console.log(
            `${String(eventId).padEnd(7)} | ${eventType.padEnd(16)} | ${(eventName ?? "?").padEnd(22)} | ${Math.floor(normalPower).toString().padEnd(10)} | ${Math.floor(eventPower).toString().padEnd(10)} | ${Math.floor(autoPower).toString().padEnd(10)} | ${totalBonusPct.toFixed(0)}%`,
        );

        results.push({
            eventId,
            eventType,
            eventName: eventName ?? "?",
            normalPower,
            eventPower,
            autoPower,
            eventBonusPct: totalBonusPct,
            eventBonusStat,
            skipped: false,
        });
    }

    // 输出 JSON 格式结果
    console.log(`\n\n// JSON 输出：`);
    console.log(
        JSON.stringify(
            results.map((r) => ({
                eventId: r.eventId,
                eventType: r.eventType,
                auto综合力: Math.floor(r.autoPower),
                普通综合力: Math.floor(r.normalPower),
                活动综合力: Math.floor(r.eventPower),
                活动加成: Math.round(r.eventBonusPct),
                skipped: r.skipped,
            })),
        ),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
