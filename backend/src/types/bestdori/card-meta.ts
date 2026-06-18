import type { Stat } from "./stat";

/** 游戏内属性（四种颜色） */
export type Attribute = "cool" | "happy" | "pure" | "powerful";

/**
 * 卡片基础元数据（用于综合力计算时查询等级对应的三围）。
 *
 * 这些数据来源于 Bestdori 卡片 API（e.g. `/api/cards/{cardId}.json`），
 * 项目按需缓存后注入到 calcStat 中即可。
 */
export interface CardMeta {
    cardId: number;
    characterId: number;
    /** 乐队 ID（如 Poppin'Party = 1） */
    bandId: number;
    rarity: number;
    attribute: Attribute;
    /** 最大等级（未特训）；特训后的 maxLevel = levelLimit */
    levelLimit: number;

    /** 各等级对应的基础三围（key 为等级字符串，value 为基础三围） */
    stat: Record<string, Stat>;

    /** 特训加成（如无可置为 undefined 或全零 Stat） */
    training?: Stat & { levelLimit?: number };

    /** 小故事加成，episodes[0] 为第一话，episodes[1] 为第二话 */
    episodes?: [Stat, Stat];
}

/** 卡片元数据查询接口 */
export interface CardMetaProvider {
    /** 根据 cardId 获取卡片元数据，缓存未命中应返回 undefined */
    getCardMeta(cardId: number): CardMeta | undefined | Promise<CardMeta | undefined>;
}

/** 不同稀有度突破一级增加的属性（参考公式） */
export function limitBreakRankStat(rarity: number): Stat {
    return {
        performance: 50 * rarity,
        technique: 50 * rarity,
        visual: 50 * rarity,
    };
}

/**
 * 根据卡片元数据计算该卡牌的综合力。
 *
 * 两种模式（跟随 tsugu 逻辑）：
 * - **玩家卡牌模式**（playerCard=true 或提供 append）：只取 `levelStat + append`
 *   level 51-60 的 Bestdori 数据已内置特训加成，不再叠加。
 *   突破（limitBreak）、剧情（episodes）也不叠加——tsugu 现行代码均已移除。
 * - **展示卡牌模式**（playerCard=false 且无 append）：`levelStat + training + episodes`
 *
 * @param meta   卡片元数据
 * @param options 等级、模式标记、附加参数等
 */
export function calcCardStat(
    meta: CardMeta,
    options: {
        level: number;
        /** 设为 true 使用玩家卡牌模式（仅 levelStat + append） */
        playerCard?: boolean;
        trainingDone?: boolean;
        limitBreak?: number;
        append?: {
            performance?: number;
            technique?: number;
            visual?: number;
            characterPotentialPerformance?: number;
            characterPotentialTechnique?: number;
            characterPotentialVisual?: number;
            characterBonusPerformance?: number;
            characterBonusTechnique?: number;
            characterBonusVisual?: number;
        };
    },
): Stat {
    const { level, playerCard, trainingDone, limitBreak = 0, append } = options;

    // 玩家卡牌模式：append 非空时自动视为玩家卡牌
    const isPlayerCard = playerCard === true || append != null;

    // 绝对最大等级 = levelLimit + trainingLevelLimit（默认 10）
    const absMaxLevel = meta.levelLimit + (meta.training?.levelLimit ?? 10);
    // 如果是玩家卡牌，level 不应超过 absMaxLevel；否则受 trainingDone 控制
    const effectiveMax = isPlayerCard || trainingDone ? absMaxLevel : meta.levelLimit;
    const key = String(Math.min(level, effectiveMax));

    const base = meta.stat[key];
    const result: Stat = base ? { performance: base.performance, technique: base.technique, visual: base.visual } : { performance: 0, technique: 0, visual: 0 };

    if (isPlayerCard) {
        // 玩家卡牌：仅加 append（训练/剧情/突破已在 Bestdori 数据中处理或 tsugu 不叠加）
        if (append) {
            result.performance += (append.performance ?? 0) + (append.characterPotentialPerformance ?? 0) + (append.characterBonusPerformance ?? 0);
            result.technique += (append.technique ?? 0) + (append.characterPotentialTechnique ?? 0) + (append.characterBonusTechnique ?? 0);
            result.visual += (append.visual ?? 0) + (append.characterPotentialVisual ?? 0) + (append.characterBonusVisual ?? 0);
        }
        // 注意：tsugu 的 calcStat 在 playerCard 模式下不加 training/episodes/limitBreak
    } else {
        // 展示卡牌模式：levelStat + training + episodes
        if (trainingDone && level <= meta.levelLimit && meta.training) {
            result.performance += meta.training.performance;
            result.technique += meta.training.technique;
            result.visual += meta.training.visual;
        }

        if (meta.episodes) {
            result.performance += meta.episodes[0].performance + meta.episodes[1].performance;
            result.technique += meta.episodes[0].technique + meta.episodes[1].technique;
            result.visual += meta.episodes[0].visual + meta.episodes[1].visual;
        }

        // 突破加成（旧 tsugu 逻辑，新 tsugu 已移除；保留用于兼容展示用途）
        if (limitBreak > 0) {
            const perBreak = limitBreakRankStat(meta.rarity);
            result.performance += perBreak.performance * limitBreak;
            result.technique += perBreak.technique * limitBreak;
            result.visual += perBreak.visual * limitBreak;
        }
    }

    return result;
}
