// songs地址: https://bestdori.com/api/songs/all.5.json
/**
 * 顶层数据结构：以歌曲 ID 为键的字典
 */
export type MusicDataResponse = Record<string, MusicItem>;

export interface MusicItem {
    tag: Tag;
    bandId: number;
    jacketImage: string[];
    // 数组中可能存在 null，统一定义以保证类型安全
    musicTitle: (string | null)[];
    publishedAt: (string | null)[];
    closedAt: (string | null)[];

    /**
     * 难度定义：固定键值为 "0" | "1" | "2" | "3" | "4"
     */
    difficulty: {
        "0": Difficulty;
        "1": Difficulty;
        "2": Difficulty;
        "3": Difficulty;
        "4"?: Difficulty;
    };

    /**
     * 视频定义：可选字段
     * 使用模板字面量类型约束 Key 格式，并确保一旦存在则必有内容
     */
    musicVideos?: {
        [key: `music_video_${string}`]: MusicVideoValue;
    };
}

export interface Difficulty {
    playLevel: number;
    // 只有部分难度（如难度 4）会包含该字段，故设为可选
    publishedAt?: (string | null)[];
}

export interface MusicVideoValue {
    startAt: (string | null)[];
}

/**
 * 歌曲类型枚举
 */
export enum Tag {
    Anime = "anime",
    Normal = "normal",
    TieUp = "tie_up",
}
