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
            "3.1": [22, 30, 24, 25, 27, 23],
            "3.2": [22, 31, 25, 26, 27, 24],
            "3.3": [23, 31, 25, 27, 28, 24],
            "3.4": [23, 32, 26, 28, 28, 25],
            "3.5": [24, 33, 27, 29, 29, 26],
            "3.6": [25, 34, 28, 30, 30, 27],
            "3.7": [26, 34, 28, 31, 31, 28],
            "3.8": [26, 35, 29, 31, 31, 28],
            "3.9": [27, 35, 29, 32, 32, 29],
            "4.0": [28, 36, 30, 33, 33, 30],
            "4.1": [29, 37, 31, 34, 34, 31],
            "4.2": [30, 37, 32, 35, 35, 31],
            "4.3": [30, 38, 33, 35, 36, 32],
            "4.4": [31, 38, 34, 36, 37, 32],
            "4.5": [32, 39, 35, 37, 38, 33],
            "4.6": [33, 40, 36, 38, 39, 34],
            "4.7": [33, 40, 37, 39, 39, 35],
            "4.8": [34, 41, 37, 39, 40, 35],
            "4.9": [34, 41, 38, 40, 40, 36],
            "5.0": [35, 42, 39, 41, 41, 37],
            "5.1": [35, 43, 40, 42, 42, 38],
            "5.2": [36, 43, 41, 42, 43, 38],
            "5.3": [36, 44, 41, 43, 43, 39],
            "5.4": [37, 44, 42, 43, 44, 39],
            "5.5": [37, 45, 43, 44, 45, 40],
            "5.6": [38, 46, 44, 45, 46, 41],
            "5.7": [39, 47, 45, 46, 47, 42],
            "5.8": [39, 47, 46, 47, 47, 43],
            "5.9": [40, 48, 47, 48, 48, 44],
            "6.0": [41, 49, 48, 49, 49, 45],
            "6.1": [42, 50, 48, 50, 50, 46],
            "6.2": [42, 50, 49, 51, 51, 47],
            "6.3": [43, 51, 49, 51, 52, 47],
            "6.4": [43, 51, 50, 52, 53, 48],
            "6.5": [44, 52, 50, 53, 54, 49],
            "6.6": [45, 53, 51, 54, 55, 50],
            "6.7": [45, 53, 52, 55, 55, 51],
            "6.8": [46, 54, 52, 55, 56, 51],
            "6.9": [46, 54, 53, 56, 56, 52],
            "7.0": [47, 55, 54, 57, 57, 53],
            "7.1": [48, 56, 54, 58, 58, 54],
            "7.2": [48, 57, 55, 59, 59, 55],
            "7.3": [49, 57, 55, 59, 59, 55],
            "7.4": [49, 58, 56, 60, 60, 56],
            "7.5": [50, 59, 56, 61, 61, 57],
            "7.6": [51, 60, 57, 62, 62, 58],
            "7.7": [52, 60, 58, 62, 62, 58],
            "7.8": [52, 61, 58, 63, 63, 59],
            "7.9": [53, 61, 59, 63, 63, 59],
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
