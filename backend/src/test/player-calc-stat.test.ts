/**
 * 综合力计算单元测试
 *
 * 测试目标：日服 (server=0) 玩家 ID=28012549
 * 预期综合力总分：415599（游戏内实际值，由 tsugu 公式验证）
 *
 * 公式：levelStat[60] + append → 基础综合力
 *       基础综合力 × (Σ 区域道具 %) → 道具加成
 *       基础 + 道具 = 最终综合力
 */

import { downloader } from "@/storage/downloader";
import type { AreaItemMeta } from "@/types/bestdori/area-item-meta";
import { calcAreaItemBonus, getBandId } from "@/types/bestdori/area-item-meta";
import type { CardMeta } from "@/types/bestdori/card-meta";
import { calcCardStat } from "@/types/bestdori/card-meta";
import type { BestdoriPlayerRaw } from "@/types/bestdori/player";
import { Player } from "@/types/bestdori/player";
import type { Stat } from "@/types/bestdori/stat";
import { addStat, emptyStat, statTotal } from "@/types/bestdori/stat";

// ============================================================================
// Bestdori API 响应类型（仅测试用，避免 any 类型）
// ============================================================================

interface BestdoriCardStatRaw {
    performance: number;
    technique: number;
    visual: number;
}

interface BestdoriTrainingRaw extends BestdoriCardStatRaw {
    levelLimit: number;
}

/** Bestdori /api/cards/{id}.json 响应结构 */
interface BestdoriCardRaw {
    characterId: number;
    rarity: number;
    attribute: string;
    levelLimit: number;
    stat: Record<string, BestdoriCardStatRaw> & {
        episodes?: BestdoriCardStatRaw[];
        training?: BestdoriTrainingRaw;
    };
}

/** Bestdori /api/areaItems/main.5.json 单条记录 */
interface BestdoriAreaItemRaw {
    areaItemName: string[];
    targetAttributes: string[];
    targetBandIds: number[];
    performance: Record<string, Array<number | null>>;
    technique: Record<string, Array<number | null>>;
    visual: Record<string, Array<number | null>>;
}

// ============================================================================
// 固化数据：玩家 28012549 的主编队（抓取自 Bestdori API）
// ============================================================================

const PLAYER_RAW: BestdoriPlayerRaw = {
    data: {
        profile: {
            publishTotalDeckPowerFlg: true,
            mainDeckUserSituations: {
                entries: [
                    {
                        situationId: 2297,
                        level: 60,
                        limitBreakRank: 4,
                        trainingStatus: "done",
                        userAppendParameter: {
                            performance: 2250,
                            technique: 2250,
                            visual: 2250,
                            characterPotentialPerformance: 664,
                            characterPotentialTechnique: 647,
                            characterPotentialVisual: 814,
                            characterBonusPerformance: 725,
                            characterBonusTechnique: 694,
                            characterBonusVisual: 873,
                        },
                    },
                    {
                        situationId: 1930,
                        level: 60,
                        limitBreakRank: 4,
                        trainingStatus: "done",
                        userAppendParameter: {
                            performance: 2250,
                            technique: 2250,
                            visual: 2250,
                            characterPotentialPerformance: 725,
                            characterPotentialTechnique: 704,
                            characterPotentialVisual: 696,
                            characterBonusPerformance: 778,
                            characterBonusTechnique: 756,
                            characterBonusVisual: 734,
                        },
                    },
                    {
                        situationId: 2285,
                        level: 60,
                        limitBreakRank: 4,
                        trainingStatus: "done",
                        userAppendParameter: {
                            performance: 2250,
                            technique: 2250,
                            visual: 2250,
                            characterPotentialPerformance: 605,
                            characterPotentialTechnique: 874,
                            characterPotentialVisual: 645,
                            characterBonusPerformance: 650,
                            characterBonusTechnique: 938,
                            characterBonusVisual: 681,
                        },
                    },
                    {
                        situationId: 2000,
                        level: 60,
                        limitBreakRank: 4,
                        trainingStatus: "done",
                        userAppendParameter: {
                            performance: 2250,
                            technique: 2250,
                            visual: 2250,
                            characterPotentialPerformance: 671,
                            characterPotentialTechnique: 668,
                            characterPotentialVisual: 782,
                            characterBonusPerformance: 720,
                            characterBonusTechnique: 717,
                            characterBonusVisual: 825,
                        },
                    },
                    {
                        situationId: 2090,
                        level: 60,
                        limitBreakRank: 4,
                        trainingStatus: "done",
                        userAppendParameter: {
                            performance: 2250,
                            technique: 2250,
                            visual: 2250,
                            characterPotentialPerformance: 673,
                            characterPotentialTechnique: 696,
                            characterPotentialVisual: 753,
                            characterBonusPerformance: 722,
                            characterBonusTechnique: 746,
                            characterBonusVisual: 794,
                        },
                    },
                ],
            },
            enabledUserAreaItems: {
                entries: [
                    { areaItemCategory: 1, level: 8 },
                    { areaItemCategory: 6, level: 8 },
                    { areaItemCategory: 11, level: 8 },
                    { areaItemCategory: 16, level: 8 },
                    { areaItemCategory: 21, level: 8 },
                    { areaItemCategory: 26, level: 8 },
                    { areaItemCategory: 31, level: 8 },
                    { areaItemCategory: 60, level: 8 },
                    { areaItemCategory: 69, level: 8 },
                    { areaItemCategory: 82, level: 8 },
                ],
            },
            cardList: [
                { characterId: 5, attribute: "pure" },
                { characterId: 2, attribute: "pure" },
                { characterId: 1, attribute: "pure" },
                { characterId: 4, attribute: "pure" },
                { characterId: 3, attribute: "pure" },
            ],
        },
    },
};

// ============================================================================
// 辅助函数
// ============================================================================

/** 判断是否为 BestdoriCardStatRaw */
function isCardStatRaw(value: unknown): value is BestdoriCardStatRaw {
    const obj = value as Record<string, unknown> | null | undefined;
    return obj != null && typeof obj.performance === "number" && typeof obj.technique === "number" && typeof obj.visual === "number";
}

/** 从 BestdoriCardRaw 构建 CardMeta */
function cardRawToMeta(cardId: number, raw: BestdoriCardRaw): CardMeta {
    const stat: Record<string, Stat> = {};
    for (const [key, val] of Object.entries(raw.stat)) {
        if (key === "episodes" || key === "training") continue;
        if (isCardStatRaw(val)) {
            stat[key] = { performance: val.performance, technique: val.technique, visual: val.visual };
        }
    }

    const training = raw.stat.training
        ? {
              performance: raw.stat.training.performance,
              technique: raw.stat.training.technique,
              visual: raw.stat.training.visual,
              levelLimit: raw.stat.training.levelLimit,
          }
        : undefined;

    const episodesRaw = raw.stat.episodes;
    const episodes: [Stat, Stat] | undefined =
        Array.isArray(episodesRaw) && episodesRaw.length >= 2 && isCardStatRaw(episodesRaw[0]) && isCardStatRaw(episodesRaw[1])
            ? [
                  { performance: episodesRaw[0].performance, technique: episodesRaw[0].technique, visual: episodesRaw[0].visual },
                  { performance: episodesRaw[1].performance, technique: episodesRaw[1].technique, visual: episodesRaw[1].visual },
              ]
            : undefined;

    // bandId 来自 Bestdori characters API 映射（1=PPP,2=AG,3=HHW,4=PP,5=Roselia,...）
    const chId = raw.characterId;
    const bandId = getBandId(chId);

    return {
        cardId,
        characterId: chId,
        bandId,
        rarity: raw.rarity,
        attribute: raw.attribute as CardMeta["attribute"],
        levelLimit: raw.levelLimit,
        stat,
        training,
        episodes,
    };
}

/** 从 BestdoriAreaItemRaw 构建 AreaItemMeta */
function areaItemRawToMeta(category: number, raw: BestdoriAreaItemRaw): AreaItemMeta {
    return {
        areaItemCategory: category,
        targetAttributes: raw.targetAttributes as AreaItemMeta["targetAttributes"],
        targetBandIds: raw.targetBandIds,
        performance: raw.performance,
        technique: raw.technique,
        visual: raw.visual,
    };
}

// ============================================================================
// 测试
// ============================================================================

describe("Player calcStat — 玩家 28012549 (日服)", () => {
    jest.setTimeout(60_000);

    let cardMetaMap: Map<number, CardMeta>;
    let areaItemMetaMap: Map<number, AreaItemMeta>;

    beforeAll(async () => {
        cardMetaMap = new Map();
        areaItemMetaMap = new Map();

        const cardIds = [2297, 1930, 2285, 2000, 2090];
        const cardResults = await Promise.all(
            cardIds.map((id) => downloader.download<BestdoriCardRaw>(`https://bestdori.com/api/cards/${id}.json`).catch(() => undefined)),
        );

        for (let i = 0; i < cardIds.length; i++) {
            const cardId = cardIds[i];
            const raw = cardResults[i];
            if (!raw) continue;

            cardMetaMap.set(cardId, cardRawToMeta(cardId, raw));
        }

        const areaItemsRaw = await downloader
            .download<Record<string, BestdoriAreaItemRaw>>("https://bestdori.com/api/areaItems/main.5.json")
            .catch(() => undefined);

        if (areaItemsRaw) {
            for (const [catStr, itemRaw] of Object.entries(areaItemsRaw)) {
                areaItemMetaMap.set(Number(catStr), areaItemRawToMeta(Number(catStr), itemRaw));
            }
        }
    });

    // --------------------------------------------------------------------------

    it("1. 单卡综合力（玩家卡牌模式 = levelStat + append）", () => {
        const player = new Player(PLAYER_RAW);

        const results: { cardId: number; stat: Stat; total: number }[] = [];

        for (const entry of player.mainDeckCards) {
            const meta = cardMetaMap.get(entry.situationId);
            if (!meta) continue;

            // tsugu 公式：仅 levelStat + append
            const cardStat = calcCardStat(meta, {
                level: entry.level,
                append: {
                    performance: entry.userAppendParameter?.performance,
                    technique: entry.userAppendParameter?.technique,
                    visual: entry.userAppendParameter?.visual,
                    characterPotentialPerformance: entry.userAppendParameter?.characterPotentialPerformance,
                    characterPotentialTechnique: entry.userAppendParameter?.characterPotentialTechnique,
                    characterPotentialVisual: entry.userAppendParameter?.characterPotentialVisual,
                    characterBonusPerformance: entry.userAppendParameter?.characterBonusPerformance,
                    characterBonusTechnique: entry.userAppendParameter?.characterBonusTechnique,
                    characterBonusVisual: entry.userAppendParameter?.characterBonusVisual,
                },
            });

            results.push({ cardId: entry.situationId, stat: cardStat, total: statTotal(cardStat) });
        }

        for (const r of results) expect(r.total).toBeGreaterThan(40000);
        expect(results).toMatchSnapshot("单卡综合力");
    });

    // --------------------------------------------------------------------------

    it("2. 基础综合力（5 张卡合计，玩家卡牌模式）", () => {
        const player = new Player(PLAYER_RAW);
        const baseStat = emptyStat();

        for (const entry of player.mainDeckCards) {
            const meta = cardMetaMap.get(entry.situationId);
            if (!meta) continue;

            addStat(
                baseStat,
                calcCardStat(meta, {
                    level: entry.level,
                    append: {
                        performance: entry.userAppendParameter?.performance,
                        technique: entry.userAppendParameter?.technique,
                        visual: entry.userAppendParameter?.visual,
                        characterPotentialPerformance: entry.userAppendParameter?.characterPotentialPerformance,
                        characterPotentialTechnique: entry.userAppendParameter?.characterPotentialTechnique,
                        characterPotentialVisual: entry.userAppendParameter?.characterPotentialVisual,
                        characterBonusPerformance: entry.userAppendParameter?.characterBonusPerformance,
                        characterBonusTechnique: entry.userAppendParameter?.characterBonusTechnique,
                        characterBonusVisual: entry.userAppendParameter?.characterBonusVisual,
                    },
                }),
            );
        }

        expect(statTotal(baseStat)).toBeGreaterThan(200000);
        expect(statTotal(baseStat)).toBeLessThan(220000);
        expect(baseStat).toMatchSnapshot("基础综合力");
    });

    // --------------------------------------------------------------------------

    it("3. 区域道具加成明细", () => {
        const player = new Player(PLAYER_RAW);

        const entry = player.mainDeckCards[0];
        const meta = cardMetaMap.get(entry.situationId);
        if (!meta) throw new Error("Card meta not found");

        const cardStat = calcCardStat(meta, {
            level: entry.level,
            append: {
                performance: entry.userAppendParameter?.performance,
                technique: entry.userAppendParameter?.technique,
                visual: entry.userAppendParameter?.visual,
                characterPotentialPerformance: entry.userAppendParameter?.characterPotentialPerformance,
                characterPotentialTechnique: entry.userAppendParameter?.characterPotentialTechnique,
                characterPotentialVisual: entry.userAppendParameter?.characterPotentialVisual,
                characterBonusPerformance: entry.userAppendParameter?.characterBonusPerformance,
                characterBonusTechnique: entry.userAppendParameter?.characterBonusTechnique,
                characterBonusVisual: entry.userAppendParameter?.characterBonusVisual,
            },
        });

        let effectiveCount = 0;
        for (const areaItem of player.areaItems) {
            const areaMeta = areaItemMetaMap.get(areaItem.areaItemCategory);
            if (!areaMeta) continue;
            const bonus = calcAreaItemBonus(areaMeta, areaItem.level, cardStat, meta.attribute, meta.bandId, 0);
            if (statTotal(bonus) > 0) effectiveCount++;
        }

        // 此玩家编队为纯 PPP + pure → 所有 10 个道具都应命中
        expect(effectiveCount).toBe(10);
    });

    // --------------------------------------------------------------------------

    it("4. 最终综合力 = 415599", () => {
        const player = new Player(PLAYER_RAW);

        const result = player.calcStatSync(
            { getCardMeta: (id: number) => cardMetaMap.get(id) },
            { getAreaItemMeta: (cat: number) => areaItemMetaMap.get(cat) },
            undefined,
            0,
        );

        const total = statTotal(result);
        console.log(`综合力: P=${result.performance} T=${result.technique} V=${result.visual}  TOTAL=${total}`);

        // 游戏内实际值：415599（浮点计算后向下取整）
        expect(Math.floor(total)).toBe(415599);

        // 分部快照
        expect({ performance: result.performance, technique: result.technique, visual: result.visual, total }).toMatchSnapshot("最终综合力");
    });

    // --------------------------------------------------------------------------

    it("5. 隐私保护：未公开综合力时返回零", () => {
        const hiddenPlayer = new Player({
            data: {
                profile: { ...PLAYER_RAW.data.profile, publishTotalDeckPowerFlg: false },
            },
        });

        const result = hiddenPlayer.calcStatSync({ getCardMeta: () => undefined }, undefined, undefined, 0);

        expect(statTotal(result)).toBe(0);
    });
});
