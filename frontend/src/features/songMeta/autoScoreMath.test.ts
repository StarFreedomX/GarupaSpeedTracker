import { describe, expect, test } from "vitest";
import { calcExactScoreInTurns, calcScore } from "@/features/songMeta/autoScoreMath";
import type { Skill, SkillDuration, SongLevelSummary } from "@/types/songMetadata";

/**
 * 构建一个所有时长键都为全零的 counts 对象。
 * 方便在测试中只关注需要用到的技能时长。
 */
function makeEmptyCounts(): Record<SkillDuration, number[]> {
    const zeroes: number[] = [0, 0, 0, 0, 0, 0];
    const result = {} as Record<SkillDuration, number[]>;
    const validDurations = [
        "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "5.6", "5.7",
        "6.0", "6.2", "6.4", "6.5", "6.8", "7.0", "7.2", "7.5", "8.0",
    ];
    for (const key of validDurations) {
        result[key as SkillDuration] = [...zeroes];
    }
    return result;
}

// 共享的完整模拟谱面数据
const mockSongLevelSummary: SongLevelSummary = {
    level: 26,
    total: 832,
    counts: {
        "3.0": [21, 29, 23, 24, 26, 22],
        "3.5": [24, 33, 27, 29, 29, 26],
        "4.0": [28, 36, 30, 33, 33, 30],
        "4.5": [32, 39, 35, 37, 38, 33],
        "5.0": [35, 42, 39, 41, 41, 37],
        "5.5": [37, 45, 43, 44, 45, 40],
        "5.6": [39, 46, 45, 46, 46, 41],
        "5.7": [39, 47, 45, 47, 47, 42],
        "6.0": [41, 49, 48, 49, 49, 45],
        "6.2": [43, 50, 48, 51, 51, 46],
        "6.4": [43, 51, 50, 52, 52, 47],
        "6.5": [44, 52, 50, 53, 54, 49],
        "6.8": [45, 52, 52, 55, 54, 50],
        "7.0": [47, 55, 54, 57, 57, 53],
        "7.2": [49, 57, 54, 59, 58, 54],
        "7.5": [50, 59, 56, 61, 61, 57],
        "8.0": [54, 62, 60, 64, 64, 60],
    },
};

describe("Bandori Score Calculation - Optimization Logic", () => {
    const mockTotalPower = 367623;
    const AUTO_PARA = 0.75;

    const mockSkills: Skill[] = [
        { duration: "7.0", scoreUp: 1.55 }, // 0
        { duration: "6.5", scoreUp: 1.3 }, // 1
        { duration: "5.0", scoreUp: 1.1 }, // 2
        { duration: "7.5", scoreUp: 1.1 }, // 3
        { duration: "5.5", scoreUp: 1.3 }, // 4
    ];

    test("should calc a exact score in turns", () => {
        const centerIndex = 0; // 155% 技能作为队长
        const skillsTurns = [2, 4, 3, 1, 0, centerIndex];
        const result = calcExactScoreInTurns(mockTotalPower, skillsTurns.map((i) => mockSkills.at(i)) as Skill[], mockSongLevelSummary, AUTO_PARA);
        expect(result).toEqual(1478372);
    });

    test("should find a valid max and min score range", () => {
        const centerIndex = 0;
        const result = calcScore(mockTotalPower, mockSkills, mockSkills[centerIndex], mockSongLevelSummary, AUTO_PARA);

        expect(result.maxScore).toBeGreaterThan(0);
        expect(result.minScore).toBeGreaterThan(0);
        expect(result.maxScore).toBeGreaterThanOrEqual(result.minScore);
    });

    test("center skill should trigger twice (at pos 6 and its assigned pos)", () => {
        const center1 = calcScore(mockTotalPower, mockSkills, mockSkills[0], mockSongLevelSummary, AUTO_PARA);
        const center2 = calcScore(mockTotalPower, mockSkills, mockSkills[4], mockSongLevelSummary, AUTO_PARA);
        expect(center2.maxScore).toBeLessThan(center1.maxScore);
    });
});

// ==================== 叠p（Progressive）技能测试 ====================

describe("Progressive Skill (叠p) Score Calculation", () => {
    /**
     * 构建一个简化的谱面用于精确手工验证。
     *
     * 选参数使 baseAutoScore = 1000（整数，方便手工计算）:
     *   totalPower = 200000
     *   level = 5       →  (level - 5)% = 0
     *   total = 600
     *   autoPara = 1.0
     *   baseAutoScore = floor(3 × 1.0 × 200000 × 1.00 / 600)
     *                  = floor(600000 / 600)
     *                  = 1000
     */
    const SIMPLE_POWER = 200000;
    const SIMPLE_PARA = 1.0;

    /**
     * 叠p技能：基准 100%（scoreUp=1.0），每次 perfect +0.5%（stepRate=0.005），上限 150%（maxCap=1.5）
     *
     * baseAutoScore = 1000 时，5个Note的手工验算：
     *   k=1: floor(1000 × (1 + 1.005)) = floor(1000 × 2.005) = 2005
     *   k=2: floor(1000 × (1 + 1.010)) = floor(1000 × 2.010) = 2010
     *   k=3: floor(1000 × (1 + 1.015)) = floor(1000 × 2.015) = 2015
     *   k=4: floor(1000 × (1 + 1.020)) = floor(1000 × 2.020) = 2020
     *   k=5: floor(1000 × (1 + 1.025)) = floor(1000 × 2.025) = 2025
     *
     * 5个Note技能分: 2005+2010+2015+2020+2025 = 10075
     * 剩余 595 个Note基础分: 595 × 1000 = 595000
     * 预期总分 = 10075 + 595000 = 605075
     */
    test("should compute exact progressive score for a few notes (no cap reached)", () => {
        const summary: SongLevelSummary = {
            level: 5,
            total: 600,
            counts: (() => {
                const c = makeEmptyCounts();
                c["7.0"] = [5, 0, 0, 0, 0, 0];
                return c;
            })(),
        };

        const progressiveSkill: Skill = {
            duration: "7.0",
            scoreUp: 1.0,
            progressive: { stepRate: 0.005, maxCap: 1.5 },
        };

        // 只有第一个槽位有叠p技能，其余均为零加成
        const skills: Skill[] = [
            progressiveSkill,
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
        ];

        const result = calcExactScoreInTurns(SIMPLE_POWER, [...skills, { duration: "7.0", scoreUp: 0 }], summary, SIMPLE_PARA);
        expect(result).toEqual(605075);
    });

    /**
     * 验证叠p技能达到上限（maxCap）后不再增长。
     *
     * 达到 150% 上限需要：1.0 + k × 0.005 >= 1.5 → k >= 100
     *
     * 前 100 个Note（加成从 100.5% 到 150%）：
     *   k=1:  2005,  k=2: 2010, ...,  k=100: 2500
     *   步长固定为 floor(1000 × 0.005) = 5
     *   等差数列求和: 2005+2010+...+2500
     *     = 100 × 2005 + 5 × (0+1+...+99)
     *     = 200500 + 5 × 99 × 100 / 2
     *     = 200500 + 24750 = 225250
     *
     * 后 500 个Note锁定在 150% 加成: 500 × floor(1000 × 2.5) = 500 × 2500 = 1250000
     *
     * 总计: 225250 + 1250000 = 1475250
     */
    test("should cap progressive bonus at maxCap and not exceed it", () => {
        const summary: SongLevelSummary = {
            level: 5,
            total: 600,
            counts: (() => {
                const c = makeEmptyCounts();
                c["7.0"] = [600, 0, 0, 0, 0, 0];
                return c;
            })(),
        };

        const progressiveSkill: Skill = {
            duration: "7.0",
            scoreUp: 1.0,
            progressive: { stepRate: 0.005, maxCap: 1.5 },
        };

        const skills: Skill[] = [
            progressiveSkill,
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
        ];

        const result = calcExactScoreInTurns(SIMPLE_POWER, [...skills, { duration: "7.0", scoreUp: 0 }], summary, SIMPLE_PARA);
        expect(result).toEqual(1475250);
    });

    /**
     * 验证叠p技能与普通技能混合使用时，calcScore 能正确找到最优/最劣路径。
     */
    test("should handle mixed progressive and normal skills in calcScore", () => {
        const progressiveSkills: Skill[] = [
            { duration: "7.0", scoreUp: 1.0, progressive: { stepRate: 0.005, maxCap: 1.5 } },
            { duration: "6.5", scoreUp: 1.3 },
            { duration: "5.0", scoreUp: 1.1 },
            { duration: "7.5", scoreUp: 1.1 },
            { duration: "5.5", scoreUp: 1.3 },
        ];

        const result = calcScore(367623, progressiveSkills, progressiveSkills[0], mockSongLevelSummary, 0.75);

        expect(result.maxScore).toBeGreaterThan(0);
        expect(result.minScore).toBeGreaterThan(0);
        expect(result.maxScore).toBeGreaterThanOrEqual(result.minScore);
    });

    /**
     * 验证全部叠p技能的队伍也能正常工作。
     */
    test("should handle all progressive skills", () => {
        const allProgressiveSkills: Skill[] = [
            { duration: "7.0", scoreUp: 1.0, progressive: { stepRate: 0.005, maxCap: 1.5 } },
            { duration: "6.5", scoreUp: 0.8, progressive: { stepRate: 0.003, maxCap: 1.3 } },
            { duration: "5.0", scoreUp: 0.6, progressive: { stepRate: 0.002, maxCap: 1.1 } },
            { duration: "7.5", scoreUp: 0.7, progressive: { stepRate: 0.004, maxCap: 1.2 } },
            { duration: "5.5", scoreUp: 0.9, progressive: { stepRate: 0.003, maxCap: 1.4 } },
        ];

        const result = calcScore(367623, allProgressiveSkills, allProgressiveSkills[0], mockSongLevelSummary, 0.75);

        expect(result.maxScore).toBeGreaterThan(0);
        expect(result.minScore).toBeGreaterThan(0);
        expect(result.maxScore).toBeGreaterThanOrEqual(result.minScore);
    });

    /**
     * 验证高 stepRate、快速达到 cap 的叠p技能的正确性。
     *
     * scoreUp=0.5, stepRate=0.1, maxCap=1.5
     * 达到上限：0.5 + k × 0.1 >= 1.5 → k >= 10
     * baseAutoScore = 1000
     *
     * k=1:   floor(1000 × 1.6) = 1600
     * k=2:   floor(1000 × 1.7) = 1700
     * k=3:   1800
     * k=4:   1900
     * k=5:   2000
     * k=6:   2100
     * k=7:   2200
     * k=8:   2300
     * k=9:   2400
     * k=10:  floor(1000 × (1 + 1.5)) = 2500
     *
     * 前10个Note总分: 1600+1700+...+2500 = 10 × 1600 + 100 × (0+1+...+9)
     *   = 16000 + 100 × 45 = 16000 + 4500 = 20500
     * 剩余590个Note基础分: 590 × 1000 = 590000
     * 总计 = 20500 + 590000 = 610500
     */
    test("should handle fast-ramping progressive skill correctly", () => {
        const summary: SongLevelSummary = {
            level: 5,
            total: 600,
            counts: (() => {
                const c = makeEmptyCounts();
                c["7.0"] = [10, 0, 0, 0, 0, 0];
                return c;
            })(),
        };

        const fastProgSkill: Skill = {
            duration: "7.0",
            scoreUp: 0.5,
            progressive: { stepRate: 0.1, maxCap: 1.5 },
        };

        const skills: Skill[] = [
            fastProgSkill,
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
            { duration: "7.0", scoreUp: 0 },
        ];

        const result = calcExactScoreInTurns(SIMPLE_POWER, [...skills, { duration: "7.0", scoreUp: 0 }], summary, SIMPLE_PARA);
        expect(result).toEqual(610500);
    });

    /**
     * 【游戏实测验证】
     * 综合力：412255
     * 技能顺序：7s155% - 7s135% - 7s100%+0.5%max150% - 7s135% - 7s110% - 7s155%
     * 游戏实测最终得分: 1701412
     */
    test("game data verification: mixed progressive team", () => {
        const skills: Skill[] = [
            { duration: "7.0", scoreUp: 1.55 },
            { duration: "7.0", scoreUp: 1.35 },
            { duration: "7.0", scoreUp: 1.0, progressive: { stepRate: 0.005, maxCap: 1.5 } },
            { duration: "7.0", scoreUp: 1.35 },
            { duration: "7.0", scoreUp: 1.1 },
            { duration: "7.0", scoreUp: 1.55 },
        ];

        const result = calcExactScoreInTurns(412255, skills, mockSongLevelSummary, 0.75);
        expect(result).toEqual(1701412);
    });
});
