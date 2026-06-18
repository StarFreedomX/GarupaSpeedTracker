/** 三围综合力 */
export interface Stat {
    performance: number;
    technique: number;
    visual: number;
}

/** 创建一个全为零的综合力对象 */
export function emptyStat(): Stat {
    return {
        performance: 0,
        technique: 0,
        visual: 0,
    };
}

/** 将 source 累加到 target（修改 target 本身） */
export function addStat(target: Stat, source: Stat): void {
    target.performance += source.performance;
    target.technique += source.technique;
    target.visual += source.visual;
}

/** 综合力求和（单维简单相加） */
export function statTotal(stat: Stat): number {
    return stat.performance + stat.technique + stat.visual;
}

/** 逐项相乘，返回新 Stat（不修改入参） */
export function mulStat(a: Stat, b: Stat): Stat {
    return {
        performance: a.performance * b.performance,
        technique: a.technique * b.technique,
        visual: a.visual * b.visual,
    };
}

/** 各维度分别乘以同一个系数 */
export function scaleStat(stat: Stat, factor: number): Stat {
    return {
        performance: stat.performance * factor,
        technique: stat.technique * factor,
        visual: stat.visual * factor,
    };
}
