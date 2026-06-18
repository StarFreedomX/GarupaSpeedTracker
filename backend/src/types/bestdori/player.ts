import type { AreaItemMeta, AreaItemMetaProvider } from "./area-item-meta";
import { calcAreaItemBonus } from "./area-item-meta";
import type { Attribute, CardMeta, CardMetaProvider } from "./card-meta";
import { calcCardStat } from "./card-meta";
import type { Stat } from "./stat";
import { addStat, emptyStat } from "./stat";

// ============================================================================
// Raw API 响应类型（Bestdori /api/player 原始返回）
// ============================================================================

export interface BestdoriPlayerRaw {
    data: {
        profile: {
            /** 是否公开综合力 */
            publishTotalDeckPowerFlg: boolean;

            /** 主编队的卡牌实例数据（计算基础三围 + 潜能加成） */
            mainDeckUserSituations: {
                entries: MainDeckCardEntry[];
            };

            /** 启用的区域道具/建筑（计算百分比加成） */
            enabledUserAreaItems: {
                entries: AreaItemEntry[];
            };

            /** 用户的完整卡牌列表（用于获取 card.characterId 和 card.attribute） */
            cardList: CardBaseInfo[];
        };
    };
}

// 1. 编队中单张卡牌的用户培养数据
export interface MainDeckCardEntry {
    situationId: number; // 卡牌 ID（用来找对应的角色和属性）
    level: number; // 卡牌等级
    limitBreakRank: number; // 突破等级/副卡槽等（视游戏版本而定）
    /** 特训状态 */
    trainingStatus?: "not_doing" | "done";
    userAppendParameter: {
        /** 用户卡牌的附加参数（潜能、额外加成等） */
        performance: number;
        technique: number;
        visual: number;
        characterPotentialPerformance: number;
        characterPotentialTechnique: number;
        characterPotentialVisual: number;
        /** 角色评级加成（v5.0+） */
        characterBonusPerformance?: number;
        characterBonusTechnique?: number;
        characterBonusVisual?: number;
    };
}

// 2. 区域道具/建筑数据
export interface AreaItemEntry {
    areaItemCategory: number; // 道具分类（分类决定它加成哪个角色或属性）
    level: number; // 道具等级（等级决定加成百分比）
}

// 3. 游戏元数据（用来匹配活动和建筑的卡牌基本属性）
export interface CardBaseInfo {
    characterId: number; // 角色 ID（如 1 代表爱音，2 代表灯）
    attribute: string; // 属性（如 pure, cool, happy, powerful）
}

// ============================================================================
// Provider 接口（同步版，async 版复用 card-meta / area-item-meta 中的定义）
// ============================================================================

export interface CardMetaProviderSync {
    getCardMeta(cardId: number): CardMeta | undefined;
}

export interface AreaItemMetaProviderSync {
    getAreaItemMeta(areaItemCategory: number): AreaItemMeta | undefined;
}

// ============================================================================
// 活动加成参数
// ============================================================================

/** 活动对卡牌的综合力加成参数 */
export interface EventBonus {
    /** 角色加成列表 */
    characters: Array<{
        characterId: number;
        percent: number;
    }>;
    /** 属性加成列表 */
    attributes: Array<{
        attribute: Attribute;
        percent: number;
    }>;
    /** 角色+属性双重加成时的额外倍率 */
    eventAttributeAndCharacterBonus?: {
        parameterPercent: number;
    };
}

// ============================================================================
// 内部共享计算中间产物
// ============================================================================

interface CalcContext {
    cardStats: Stat[];
    cardMetas: (CardMeta | undefined)[];
    baseStat: Stat;
}

// ============================================================================
// Player 类
// ============================================================================

export class Player {
    /** 主编队卡牌数据 */
    readonly mainDeckCards: MainDeckCardEntry[];
    /** 启用中的区域道具 */
    readonly areaItems: AreaItemEntry[];
    /** 卡牌基础信息（用于匹配属性/角色） */
    readonly cardList: CardBaseInfo[];
    /** 是否公开综合力 */
    readonly publishTotalDeckPowerFlg: boolean;

    constructor(raw: BestdoriPlayerRaw) {
        const profile = raw.data.profile;
        this.publishTotalDeckPowerFlg = profile.publishTotalDeckPowerFlg;
        this.mainDeckCards = profile.mainDeckUserSituations?.entries ?? [];
        this.areaItems = profile.enabledUserAreaItems?.entries ?? [];
        this.cardList = profile.cardList ?? [];
    }

    // ========================================================================
    // 公共方法
    // ========================================================================

    /**
     * 计算综合力（总合値）— 异步版。
     *
     * 计算过程：
     *   1. 基础三围 = 每张卡（等级基础值 + 潜能/角色加成）
     *   2. 区域道具加成 = Σ 每个道具对每张匹配卡的百分比加成
     *   3. 活动加成（可选）= 角色加成 + 属性加成 + 双中加成
     *   4. 最终综合力 = 基础 + 道具 + 活动
     *
     * **隐私控制**：若玩家未公开综合力则直接返回全零。
     */
    async calcStat(cardMetaProvider: CardMetaProvider, areaItemMetaProvider?: AreaItemMetaProvider, eventBonus?: EventBonus, serverIndex = 0): Promise<Stat> {
        if (!this.publishTotalDeckPowerFlg) return emptyStat();

        const ctx = await this.computeBaseStats(cardMetaProvider);
        const areaStat = await this.computeAreaBonus(ctx, areaItemMetaProvider, serverIndex);
        const eventStat = this.computeEventBonus(ctx, eventBonus);

        return this.sumStats(ctx.baseStat, areaStat, eventStat);
    }

    /**
     * 计算综合力（总合値）— 同步版。
     *
     * 要求 cardMetaProvider / areaItemMetaProvider 的所有查询均为同步返回。
     */
    calcStatSync(cardMetaProvider: CardMetaProviderSync, areaItemMetaProvider?: AreaItemMetaProviderSync, eventBonus?: EventBonus, serverIndex = 0): Stat {
        if (!this.publishTotalDeckPowerFlg) return emptyStat();

        const ctx = this.computeBaseStatsSync(cardMetaProvider);
        const areaStat = this.computeAreaBonusSync(ctx, areaItemMetaProvider, serverIndex);
        const eventStat = this.computeEventBonus(ctx, eventBonus);

        return this.sumStats(ctx.baseStat, areaStat, eventStat);
    }

    // ========================================================================
    // 第 1 步：卡牌基础综合力
    // ========================================================================

    private async computeBaseStats(provider: CardMetaProvider): Promise<CalcContext> {
        const cardStats: Stat[] = [];
        const cardMetas: (CardMeta | undefined)[] = [];
        const baseStat = emptyStat();

        for (const entry of this.mainDeckCards) {
            const meta = await provider.getCardMeta(entry.situationId);
            cardMetas.push(meta);

            const stat = meta ? this.calcSingleCard(meta, entry) : emptyStat();
            cardStats.push(stat);
            addStat(baseStat, stat);
        }

        return { cardStats, cardMetas, baseStat };
    }

    private computeBaseStatsSync(provider: CardMetaProviderSync): CalcContext {
        const cardStats: Stat[] = [];
        const cardMetas: (CardMeta | undefined)[] = [];
        const baseStat = emptyStat();

        for (const entry of this.mainDeckCards) {
            const meta = provider.getCardMeta(entry.situationId);
            cardMetas.push(meta);

            const stat = meta ? this.calcSingleCard(meta, entry) : emptyStat();
            cardStats.push(stat);
            addStat(baseStat, stat);
        }

        return { cardStats, cardMetas, baseStat };
    }

    /** 计算单张卡牌的玩家综合力（tsugu 公式：levelStat + append） */
    private calcSingleCard(meta: CardMeta, entry: MainDeckCardEntry): Stat {
        const ap = entry.userAppendParameter;
        return calcCardStat(meta, {
            level: entry.level,
            append: {
                performance: ap?.performance,
                technique: ap?.technique,
                visual: ap?.visual,
                characterPotentialPerformance: ap?.characterPotentialPerformance,
                characterPotentialTechnique: ap?.characterPotentialTechnique,
                characterPotentialVisual: ap?.characterPotentialVisual,
                characterBonusPerformance: ap?.characterBonusPerformance,
                characterBonusTechnique: ap?.characterBonusTechnique,
                characterBonusVisual: ap?.characterBonusVisual,
            },
        });
    }

    // ========================================================================
    // 第 2 步：区域道具加成
    // ========================================================================

    private async computeAreaBonus(ctx: CalcContext, provider?: AreaItemMetaProvider, serverIndex = 0): Promise<Stat> {
        if (!provider) return emptyStat();

        const bonusStat = emptyStat();

        for (const areaItem of this.areaItems) {
            const areaMeta = await provider.getAreaItemMeta(areaItem.areaItemCategory);
            if (!areaMeta) continue;

            this.applyAreaItem(bonusStat, areaMeta, areaItem.level, ctx, serverIndex);
        }

        return bonusStat;
    }

    private computeAreaBonusSync(ctx: CalcContext, provider?: AreaItemMetaProviderSync, serverIndex = 0): Stat {
        if (!provider) return emptyStat();

        const bonusStat = emptyStat();

        for (const areaItem of this.areaItems) {
            const areaMeta = provider.getAreaItemMeta(areaItem.areaItemCategory);
            if (!areaMeta) continue;

            this.applyAreaItem(bonusStat, areaMeta, areaItem.level, ctx, serverIndex);
        }

        return bonusStat;
    }

    private applyAreaItem(target: Stat, areaMeta: AreaItemMeta, level: number, ctx: CalcContext, serverIndex: number): void {
        for (let j = 0; j < ctx.cardStats.length; j++) {
            const cardMeta = ctx.cardMetas[j];
            if (!cardMeta) continue;

            const bonus = calcAreaItemBonus(areaMeta, level, ctx.cardStats[j], cardMeta.attribute, cardMeta.bandId, serverIndex);
            addStat(target, bonus);
        }
    }

    // ========================================================================
    // 第 3 步：活动加成
    // ========================================================================

    private computeEventBonus(ctx: CalcContext, eventBonus?: EventBonus): Stat {
        if (!eventBonus) return emptyStat();

        const bonusStat = emptyStat();

        for (let i = 0; i < ctx.cardStats.length; i++) {
            const cardMeta = ctx.cardMetas[i];
            if (!cardMeta) continue;

            this.applyEventBonus(bonusStat, ctx.cardStats[i], cardMeta, eventBonus);
        }

        return bonusStat;
    }

    private applyEventBonus(target: Stat, cardStat: Stat, cardMeta: CardMeta, eventBonus: EventBonus): void {
        let isCharacterMatch = false;
        let isAttributeMatch = false;

        for (const charBonus of eventBonus.characters) {
            if (cardMeta.characterId === charBonus.characterId) {
                addStat(target, this.scaleStatPercent(cardStat, charBonus.percent));
                isCharacterMatch = true;
                break;
            }
        }

        for (const attrBonus of eventBonus.attributes) {
            if (cardMeta.attribute === attrBonus.attribute) {
                addStat(target, this.scaleStatPercent(cardStat, attrBonus.percent));
                isAttributeMatch = true;
                break;
            }
        }

        if (isCharacterMatch && isAttributeMatch && eventBonus.eventAttributeAndCharacterBonus?.parameterPercent) {
            addStat(target, this.scaleStatPercent(cardStat, eventBonus.eventAttributeAndCharacterBonus.parameterPercent));
        }
    }

    private scaleStatPercent(stat: Stat, percent: number): Stat {
        return {
            performance: (stat.performance * percent) / 100,
            technique: (stat.technique * percent) / 100,
            visual: (stat.visual * percent) / 100,
        };
    }

    // ========================================================================
    // 第 4 步：累加
    // ========================================================================

    private sumStats(base: Stat, area: Stat, event: Stat): Stat {
        return {
            performance: base.performance + area.performance + event.performance,
            technique: base.technique + area.technique + event.technique,
            visual: base.visual + area.visual + event.visual,
        };
    }
}
