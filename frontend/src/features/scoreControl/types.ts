import type { Skill } from "@/types/songMetadata";
import type { FeasibleBonusResult } from "@/features/PT/calcSinglePT";

/** 支持的活动类型 */
export type ActivityType = "mission" | "try" | "challenge" | "versus" | "5v5" | "medley1";

/** 火焰倍率映射 (PT 倍率, 不是分数倍率) */
export const FLAME_MULTIPLIERS = [1, 5, 10, 15] as const;

/** 队伍配置 */
export interface TeamConfig {
    totalPower: number;
    supportBandPower: number;
    eventBonus: number;
    autoPara: number;
    skills: Skill[];
    centerIndex: number;
}

/** 单个火焰等级的信息 */
export interface BoostLevelPT {
    flames: number;
    multiplier: number;
    /** 该火焰等级下所有固定PT歌曲的可达成 basePT 值集合（去重排序） */
    achievableBasePTs: number[];
}

/** 精确解中的一步：一次游玩 */
export interface PlayStep {
    flames: number;
    multiplier: number;
    /** 本次需要达到的基础 PT（未乘火） */
    basePT: number;
    /** 本次的 boostedPT = basePT × multiplier */
    boostedPT: number;
    /** 可以达成该 basePT 的固定PT歌曲列表 */
    songs: RecommendedSong[];
}

/** 方案筛选条件（每个筛选有独立启用开关） */
export interface SolutionFilter {
    /** 是否允许 FULL 曲 */
    allowFull: boolean;
    /** 是否启用乐队筛选 */
    bandEnabled: boolean;
    /** 乐队 ID */
    bandId: number | null;
    /** 乐队筛选模式：contains = 至少一首，all = 全部必须是 */
    bandMode: "contains" | "all";
    /** 是否启用权重字符串 */
    boostEnabled: boolean;
    /** 提升权重的字符串 */
    boostString: string | null;
}

/** 推荐的歌曲信息 */
export interface RecommendedSong {
    songId: number;
    songName: string;
    difficultyKey: string;
    difficultyLabel: string;
    /** 固定 basePT 值（min==max） */
    basePT: number;
    /** auto 最低分 */
    minScore: number;
    /** auto 最高分 */
    maxScore: number;
    /** 乐队 ID */
    bandId: number;
    /** 是否匹配 boostString */
    matchesBoost: boolean;
}

/** 一个完整的策略组合 */
export interface Strategy {
    /** 是否可行 */
    feasible: boolean;
    /** 游玩次数 */
    totalPlays: number;
    /** 火焰等级分配 */
    flameIndices: number[];
    /** 每步的 basePT 值 */
    basePTs: number[];
    /** 构建好的 PlayStep 数组 */
    steps?: PlayStep[];
}

/** 分析结果 */
export interface AnalysisResult {
    /** 是否有精确可行方案 */
    feasible: boolean;
    /** 各火焰等级的 PT 信息 */
    boostLevels: BoostLevelPT[];
    /** 主策略 */
    strategy: PlayStep[];
    /** 备选方案（不包括主策略） */
    alternatives: PlayStep[][];
    /** 不可行时：可行的加成建议 */
    feasibleBonuses?: FeasibleBonusResult[];
    /** 不可行时：最大可达 PT（5把3火，固定PT歌曲） */
    maxAchievablePT?: number;
    /** 不可行时：目标 PT 低于最小可达 basePT（无论如何都达不到这么低） */
    targetTooLow?: boolean;
}
