/* 谱面数据url为https://bestdori.com/api/charts/{songId}/{difficulty}.json
    如 https://bestdori.com/api/charts/1/expert.json
 */

export type Direction = "Left" | "Right";

export interface NotePoint {
    lane: number;
    beat: number;
    /** * 在 Slide/Long 的连接点中，如果为 true，表示该连接点需要向上划动判定（通常指结尾点）
     */
    flick?: boolean;
    /**
     * 是否为路径插值点（不渲染图标，仅用于计算路径曲线）
     * 只在 Slide 中出现
     */
    hidden?: boolean;
    /**
     * 是否为fever充能
     */
    charge?: boolean;
    skill?: boolean;
}

/** 1. 基础事件与设定 */
export interface BPMEvent {
    type: "BPM";
    bpm: number;
    beat: number;
}

export interface SystemEvent {
    type: "System";
    data: string;
    beat: number;
}

/** 2. 常规音符 */
export interface SingleNote {
    type: "Single";
    lane: number;
    beat: number;
    /** 全方向划动判定 */
    flick?: boolean;
    /** 技能触发键标记 */
    skill?: boolean;
    charge?: boolean;
}

/** 3. 长按与滑条 */
export interface ConnectionNote {
    type: "Long" | "Slide";
    connections: NotePoint[];
}

/** 4. 方向性音符 (侧滑) */
export interface DirectionalNote {
    type: "Directional";
    lane: number;
    beat: number;
    direction: Direction;
    /** 占据的轨道宽度（例如 1, 2, 3） */
    width: number;
}

/** 统一类型定义 */
export type ChartItem = BPMEvent | SystemEvent | SingleNote | ConnectionNote | DirectionalNote;

export type Chart = ChartItem[];
