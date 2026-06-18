/**
 * 技能时长选项类型
 * 覆盖 3.0s 到 8.0s，步长 0.1s
 */
export type SkillDuration =
    | `${3}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | `${4}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | `${5}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | `${6}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | `${7}.${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
    | "8.0";

export interface Skill {
    /**
     * 分数的"提升"，不算基础的"1"
     * 如130%up就直接传入1.3
     */
    scoreUp: number;
    duration: SkillDuration;
    /**
     * 叠p技能：技能区间内每达成一次Perfect，分数加成额外提升。
     * 在auto模式下默认全部Perfect，因此每个Note都会触发叠p。
     * 第k个Note的加成倍率 = min(scoreUp + k × stepRate, maxCap)
     * 最终分数 = floor(baseAutoScore × (1 + 加成倍率))
     *
     * 示例：scoreUp=1.0, stepRate=0.005, maxCap=1.5
     * 第1键：100% + 0.5% = 100.5% 加成 → 200.5% 分数
     * 第2键：100% + 1.0% = 101% 加成 → 201% 分数
     * ...
     * 达到150%上限后锁定在150%
     */
    progressive?: {
        /** 每次Perfect的额外加成（如 0.5% = 0.005） */
        stepRate: number;
        /** 最高加成上限（如 150% = 1.5） */
        maxCap: number;
    };
}
/**
 * 基础歌曲元数据
 * 用于 Summary 索引表，支持全曲库快速排序
 */
export interface SongLevelSummary {
    level: number;
    /**
     * 谱面总note数
     */
    total: number;
    /** * 针对不同技能时长的 Note 计数映射
     * Key: 时长字符串 (例如 "7.0")
     * Value: 长度为 6 的数组，对应 6 个技能窗口覆盖的 Note 数量
     */
    counts: Record<SkillDuration, number[]>;
}

export type SongSummary = {
    "0": SongLevelSummary;
    "1": SongLevelSummary;
    "2": SongLevelSummary;
    "3": SongLevelSummary;
    "4"?: SongLevelSummary;
};

export interface SongChartMeta {
    [song_id: number]: SongSummary;
}
