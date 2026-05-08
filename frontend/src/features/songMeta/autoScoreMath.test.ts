import { describe, expect, test } from "vitest";
import { calcExactScoreInTurns, calcScore } from "@/features/songMeta/autoScoreMath";
import type { Skill, SongLevelSummary } from "@/types/songMetadata";

describe("Bandori Score Calculation - Optimization Logic", () => {
    // 模拟基础数据
    const mockTotalPower = 367623;

    const AUTO_PARA = 0.75;

    // 模拟谱面数据
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
            "6.0": [41, 49, 48, 49, 49, 45],
            "6.5": [44, 52, 50, 53, 54, 49],
            "7.0": [47, 55, 54, 57, 57, 53],
            "7.5": [50, 59, 56, 61, 61, 57],
            "8.0": [54, 62, 60, 64, 64, 60],
        },
    };

    // 模拟技能组：5 个不同的技能，强度和时长各异
    const mockSkills: Skill[] = [
        { duration: "7.0", scoreUp: 1.55 }, // 0
        { duration: "6.5", scoreUp: 1.3 }, // 1
        { duration: "5.0", scoreUp: 1.1 }, // 2
        { duration: "7.5", scoreUp: 1.1 }, // 3
        { duration: "5.5", scoreUp: 1.3 }, // 4
    ];

    test("should calc a exact score in turns", () => {
        // 1202
        // 2524 5s 110%
        // 2764 5.5s 130%
        // 2524 7.5s 110%
        // 2764 6.5s 130%
        // 3065 7s 155%
        // 3065 7s 155%
        const centerIndex = 0; // 155% 技能作为队长
        const skillsTurns = [2, 4, 3, 1, 0, centerIndex];
        const result = calcExactScoreInTurns(mockTotalPower, skillsTurns.map((i) => mockSkills.at(i)) as Skill[], mockSongLevelSummary, AUTO_PARA);
        expect(result).toEqual(1478372);
    });

    test("should find a valid max and min score range", () => {
        const centerIndex = 0; // 155% 技能作为队长
        const result = calcScore(mockTotalPower, mockSkills, mockSkills[centerIndex], mockSongLevelSummary, AUTO_PARA);

        expect(result.maxScore).toBeGreaterThan(0);
        expect(result.minScore).toBeGreaterThan(0);
        expect(result.maxScore).toBeGreaterThanOrEqual(result.minScore);

        console.log(`Max Score: ${result.maxScore}, Min Score: ${result.minScore}`);
        console.log(`Max Path is: ${result.maxPath}, Min Path is: ${result.minScore}`);
    });

    test("center skill should trigger twice (at pos 6 and its assigned pos)", () => {
        const center1 = calcScore(mockTotalPower, mockSkills, mockSkills[0], mockSongLevelSummary, AUTO_PARA);
        const center2 = calcScore(mockTotalPower, mockSkills, mockSkills[4], mockSongLevelSummary, AUTO_PARA);
        expect(center2.maxScore).toBeLessThan(center1.maxScore);
    });
});
