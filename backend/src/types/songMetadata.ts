/**
 * 技能时长选项类型
 * 基于 Bestdori skills/all.10.json 中实际出现的所有时长值
 * 共 17 个可能值（各技能 5 个等级对应的时长集合去重）
 */
export type SkillDuration =
    | "3.0" | "3.5" | "4.0" | "4.5" | "5.0"
    | "5.5" | "5.6" | "5.7" | "6.0" | "6.2" | "6.4" | "6.5" | "6.8" | "7.0" | "7.2" | "7.5"
    | "8.0";
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
