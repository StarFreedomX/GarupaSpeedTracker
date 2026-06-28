import type { Attribute } from "./card-meta";
import type { Stat } from "./stat";

/**
 * 将角色 ID 映射为 Bestdori 乐队 ID，用于区域道具 `targetBandIds` 匹配。
 *
 * ch1-25 按游戏内发布顺序排列，`Math.ceil(characterId / 5)` 恰好正确：
 * - ch1-5   (Poppin'Party)       → 1
 * - ch6-10  (Afterglow)          → 2
 * - ch11-15 (Hello, Happy World!)→ 3
 * - ch16-20 (Pastel*Palettes)    → 4
 * - ch21-25 (Roselia)            → 5
 *
 * ch26+ 的 bandId 不连续，需要显式映射（数据来源：/api/characters/main.2.json）：
 * - ch26-30 (Morfonica)          → 21
 * - ch31-35 (RAISE A SUILEN)     → 18
 * - ch36-40 (MyGO!!!!!)          → 45
 *
 * 若预加载了 bandIdMap（通过 `setBandIdMap()`），则优先使用。
 * 未知角色回退到 `Math.ceil(characterId / 5)`。
 */
let bandIdMap: Map<number, number> | undefined;

export function getBandId(characterId: number): number {
    if (bandIdMap) {
        const mapped = bandIdMap.get(characterId);
        if (mapped != null) return mapped;
    }

    // ch26+ 显式映射
    const OVERRIDE_RANGES: Array<[number, number, number]> = [
        [26, 30, 21], // Morfonica
        [31, 35, 18], // RAISE A SUILEN
        [36, 40, 45], // MyGO!!!!!
    ];
    for (const [lo, hi, bandId] of OVERRIDE_RANGES) {
        if (characterId >= lo && characterId <= hi) return bandId;
    }

    // ch1-25: Math.ceil(ch/5) 恰好等于 Bestdori bandId
    return Math.ceil(characterId / 5);
}

/**
 * 设置角色→乐队映射，数据来源为 `/api/characters/main.2.json`。
 * 调用一次后，`getBandId()` 会优先使用此映射。
 */
export function setBandIdMap(all: Record<string, { bandId: number }>): void {
    const map = new Map<number, number>();
    for (const [chIdStr, raw] of Object.entries(all)) {
        const chId = Number(chIdStr);
        const bandId = Number(raw.bandId);
        if (!Number.isNaN(chId) && !Number.isNaN(bandId)) {
            map.set(chId, bandId);
        }
    }
    bandIdMap = map;
}

/**
 * 区域道具（建筑）的元数据，用于综合力计算。
 *
 * 数据来源于 Bestdori 区域道具 API（e.g. `/api/areaItems/{id}.json`）。
 */
export interface AreaItemMeta {
    areaItemCategory: number;
    /** 目标属性（道具只对同色卡生效） */
    targetAttributes: Attribute[];
    /** 目标乐队 ID（道具只对同乐队卡生效，如 1=PPP, 2=Afterglow 等） */
    targetBandIds: number[];

    /** 各等级对应的百分比加成（key 为等级字符串，value 为各服百分比，null 表示该服未实装） */
    performance: Record<string, Array<number | null>>;
    technique: Record<string, Array<number | null>>;
    visual: Record<string, Array<number | null>>;
}

/** 区域道具查询接口 */
export interface AreaItemMetaProvider {
    getAreaItemMeta(areaItemCategory: number): AreaItemMeta | undefined | Promise<AreaItemMeta | undefined>;
}

/**
 * 计算单个区域道具对单张卡牌的综合力加成。
 *
 * 规则：只有卡牌的 attribute 和 bandId 同时命中道具的目标范围才生效。
 *
 * @param meta           区域道具元数据
 * @param areaItemLevel  道具当前等级
 * @param cardStat       卡牌自身综合力（算完基础+潜能后）
 * @param cardAttribute  卡牌属性
 * @param cardBandId     卡牌所属乐队
 * @param serverIndex    服务器索引（日服=0, 国服=3 等，默认 0）
 */
export function calcAreaItemBonus(
    meta: AreaItemMeta,
    areaItemLevel: number,
    cardStat: Stat,
    cardAttribute: Attribute,
    cardBandId: number,
    serverIndex = 0,
): Stat {
    const empty: Stat = { performance: 0, technique: 0, visual: 0 };

    // 必须同时命中属性目标与乐队目标
    if (!meta.targetAttributes.includes(cardAttribute) || !meta.targetBandIds.includes(cardBandId)) {
        return empty;
    }

    const levelKey = String(areaItemLevel);

    const perfVal = meta.performance[levelKey]?.[serverIndex];
    const techVal = meta.technique[levelKey]?.[serverIndex];
    const visVal = meta.visual[levelKey]?.[serverIndex];

    if (perfVal == null && techVal == null && visVal == null) {
        return empty;
    }

    const perfPct = perfVal != null ? perfVal / 100 : 0;
    const techPct = techVal != null ? techVal / 100 : 0;
    const visPct = visVal != null ? visVal / 100 : 0;

    return {
        performance: cardStat.performance * perfPct,
        technique: cardStat.technique * techPct,
        visual: cardStat.visual * visPct,
    };
}
