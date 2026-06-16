/**
 * 技能时长选项类型
 * 覆盖 3.0s 到 8.0s，步长 0.1s
 */
type Decimals = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type SkillDuration = `${3 | 4 | 5 | 6 | 7}.${Decimals}` | "8.0";
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
