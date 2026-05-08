/**
 * 技能时长选项类型
 * 覆盖 3.0s 到 8.0s，步长 0.5s
 */
export type SkillDuration = "3.0" | "3.5" | "4.0" | "4.5" | "5.0" | "5.5" | "6.0" | "6.5" | "7.0" | "7.5" | "8.0";

export interface Skill {
    /**
     * 分数的"提升"，不算基础的"1"
     * 如130%up就直接传入1.3
     */
    scoreUp: number;
    duration: SkillDuration;
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
