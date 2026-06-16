import { calcEventPT, type BonusParams, getFeasibleBonus } from "@/features/PT/calcSinglePT";
import { calcScore } from "@/features/songMeta/autoScoreMath";
import type { Skill, SongChartMeta, SongLevelSummary } from "@/types/songMetadata";
import type { MusicDataResponse } from "@/types/songs";
import {
    type ActivityType,
    type AnalysisResult,
    type BoostLevelPT,
    FLAME_MULTIPLIERS,
    type PlayStep,
    type RecommendedSong,
    type SolutionFilter,
    type Strategy,
    type TeamConfig,
} from "./types";

// ─── helpers ───

function calcBasePT(score: number, type: ActivityType, config: TeamConfig): number {
    switch (type) {
        case "mission":
            return calcEventPT(score, { type: "mission", supportBandPower: config.supportBandPower, eventBonus: config.eventBonus });
        case "try":
            return calcEventPT(score, { type: "try", eventBonus: config.eventBonus });
        case "challenge":
            return calcEventPT(score, { type: "challenge", eventBonus: config.eventBonus });
        case "versus":
            return calcEventPT(score, { type: "versus" });
        case "5v5":
            return calcEventPT(score, { type: "5v5" });
        case "medley1":
            return calcEventPT(score, { type: "medley1" });
    }
}

function buildBonusParams(type: ActivityType, config: TeamConfig): BonusParams | null {
    switch (type) {
        case "mission": return { type: "mission", supportBandPower: config.supportBandPower };
        case "try": return { type: "try" };
        case "challenge": return { type: "challenge" };
        default: return null;
    }
}

const DIFFICULTY_LABELS: Record<string, string> = {
    "0": "Easy", "1": "Normal", "2": "Hard", "3": "Expert", "4": "Special",
};

// ─── combination generator ───

/** 生成非递减组合 (0..n-1 选 k，可重复)，消除火焰排列的对称性 */
function* generateNonDecreasingCombos(n: number, k: number): Generator<number[]> {
    if (k === 0) { yield []; return; }
    const indices = new Array(k).fill(0);
    while (true) {
        yield [...indices];
        let i = k - 1;
        while (i >= 0 && indices[i] === n - 1) i--;
        if (i < 0) break;
        indices[i]++;
        for (let j = i + 1; j < k; j++) indices[j] = indices[i]; // 关键：从 indices[i] 开始，保证非递减
    }
}

// ─── collect fixed-PT songs ───

/**
 * 收集所有固定PT歌曲（minBasePT == maxBasePT）的去重 basePT 值
 * 同时构建 basePT → 歌曲列表的映射
 */
/** 排除的非正式常驻曲目标识 */
const EXCLUDE_TITLE_TOKENS = ["超高難易度", "新SPECIAL"];

export function computeFixedBasePTs(
    config: TeamConfig,
    activityType: ActivityType,
    songMetadata: SongChartMeta,
    songList: MusicDataResponse,
    filter: SolutionFilter,
): { achievableBasePTs: number[]; songMap: Map<number, RecommendedSong[]> } {
    const centerSkill = config.skills[config.centerIndex] as Skill | undefined;
    if (!centerSkill) return { achievableBasePTs: [], songMap: new Map() };

    const ptSet = new Set<number>();
    const songMap = new Map<number, RecommendedSong[]>();

    for (const [songIdStr, songSummary] of Object.entries(songMetadata)) {
        const songId = Number(songIdStr);
        const musicItem = songList[songIdStr];
        const musicTitle = musicItem?.musicTitle;
        const title = musicTitle?.filter(Boolean).at(0) ?? "unknown";
        const bandId = musicItem?.bandId ?? 0;

        // 排除特殊非正式常驻曲
        if (EXCLUDE_TITLE_TOKENS.some((t) => title.includes(t))) continue;
        // 硬过滤：禁止 FULL 曲
        if (!filter.allowFull && title.includes("[FULL]")) continue;
        // 硬过滤：必须是某乐队（仅启用时）
        if (filter.bandEnabled && filter.bandMode === "all" && filter.bandId !== null && bandId !== filter.bandId) continue;

        const matchesBoost = (filter.boostEnabled && filter.boostString) ? title.includes(filter.boostString) : false;

        for (let d = 0; d <= 4; d++) {
            const diffKey = String(d) as "0" | "1" | "2" | "3" | "4";
            const levelSummary: SongLevelSummary | undefined = songSummary[diffKey];
            if (!levelSummary) continue;

            try {
                const scoreResult = calcScore(
                    config.totalPower, config.skills, centerSkill, levelSummary, config.autoPara,
                );
                const minScore = Math.floor(scoreResult.minScore);
                const maxScore = Math.floor(scoreResult.maxScore);

                const minBasePT = calcBasePT(minScore, activityType, config);
                const maxBasePT = calcBasePT(maxScore, activityType, config);

                if (minBasePT === maxBasePT) {
                    ptSet.add(minBasePT);
                    const song: RecommendedSong = {
                        songId,
                        songName: title,
                        difficultyKey: diffKey,
                        difficultyLabel: DIFFICULTY_LABELS[diffKey] ?? diffKey,
                        basePT: minBasePT,
                        minScore,
                        maxScore,
                        bandId,
                        matchesBoost,
                    };
                    const existing = songMap.get(minBasePT);
                    if (existing) {
                        existing.push(song);
                    } else {
                        songMap.set(minBasePT, [song]);
                    }
                }
            } catch {
                continue;
            }
        }
    }

    const achievableBasePTs = [...ptSet].sort((a, b) => a - b);
    return { achievableBasePTs, songMap };
}

/**
 * 计算各火焰等级的信息（共用固定PT集合）
 */
export function computeBoostLevelPTs(achievableBasePTs: number[]): BoostLevelPT[] {
    return FLAME_MULTIPLIERS.map((multiplier, f) => ({
        flames: f,
        multiplier,
        achievableBasePTs,
    }));
}

// ─── exact solution search (discrete set) ───

function binarySearch(arr: number[], target: number): number {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] === target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

/**
 * 判断一个 basePT 是否可达
 */
function isBasePTOk(bp: number, basePTs: number[]): boolean {
    return binarySearch(basePTs, bp) >= 0;
}

// ─── pre-filter helpers ───

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const arrayGcd = (arr: number[]): number => arr.reduce(gcd, 0);

// ─── find all solutions for a given play count ───

function findAllSolutionsForN(
    targetPT: number,
    n: number,
    basePTs: number[],
    maxSolutions: number,
): Strategy[] {
    const solutions: Strategy[] = [];
    const minBP = basePTs[0];
    const maxBP = basePTs[basePTs.length - 1];

    // ── 预过滤 1：总倍率和范围 ──
    // 对于 N 局，可能的"总倍率" M = m₁+...+mₙ (mᵢ ∈ {1,5,10,15})
    // 要求 minBP × M ≤ targetPT ≤ maxBP × M
    // 即 targetPT/maxBP ≤ M ≤ targetPT/minBP
    const mMin = Math.ceil(targetPT / maxBP);
    const mMax = Math.floor(targetPT / minBP);

    // 收集所有满足 M 范围的火焰组合
    const combos: number[][] = [];
    for (const combo of generateNonDecreasingCombos(4, n)) {
        const totalM = combo.reduce((s, fi) => s + FLAME_MULTIPLIERS[fi], 0);
        if (totalM < mMin || totalM > mMax) continue;
        // ── 预过滤 2：全火组合 GCD 整除检查 ──
        // 若所有 mᵢ 均不含 ×1（即没有 0火），则 targetPT 必须能被 5 整除
        const multipliers = combo.map((fi) => FLAME_MULTIPLIERS[fi]);
        const g = arrayGcd(multipliers);
        if (g > 1 && targetPT % g !== 0) continue;
        combos.push(combo);
    }

    // 按火焰总等级降序
    combos.sort((a, b) => {
        const sumA = a.reduce((s, x) => s + FLAME_MULTIPLIERS[x], 0);
        const sumB = b.reduce((s, x) => s + FLAME_MULTIPLIERS[x], 0);
        return sumB - sumA;
    });

    for (const combo of combos) {
        if (solutions.length >= maxSolutions) break;

        const multipliers = combo.map((fi) => FLAME_MULTIPLIERS[fi]);
        findAllAllocations(targetPT, combo, multipliers, 0, [], basePTs, solutions, maxSolutions);
    }

    return solutions;
}

function findAllAllocations(
    remaining: number,
    flameIndices: number[],
    multipliers: number[],
    idx: number,
    current: number[],
    basePTs: number[],
    solutions: Strategy[],
    maxSolutions: number,
): void {
    if (solutions.length >= maxSolutions) return;

    if (idx === flameIndices.length - 1) {
        const m = multipliers[idx];
        if (remaining % m !== 0) return;
        const bp = remaining / m;
        if (bp <= 0) return;
        if (!isBasePTOk(bp, basePTs)) return;
        // 对称剪枝：与前一位置火焰相同 ⇒ bp 必须 ≥ 前一 bp
        if (idx > 0 && multipliers[idx] === multipliers[idx - 1] && bp < current[idx - 1]) return;
        solutions.push({
            feasible: true,
            totalPlays: flameIndices.length,
            flameIndices: [...flameIndices],
            basePTs: [...current, bp],
        });
        return;
    }

    const m = multipliers[idx];
    const minBP = basePTs[0];
    const maxBP = basePTs[basePTs.length - 1];

    // 计算剩余所有步的最小/最大贡献和
    let minRest = 0;
    let maxRest = 0;
    for (let j = idx + 1; j < flameIndices.length; j++) {
        minRest += minBP * multipliers[j];
        maxRest += maxBP * multipliers[j];
    }

    // 对称剪枝：与前一位置火焰相同 ⇒ 起始 bp 不能小于前一 bp
    const startIdx = (idx > 0 && multipliers[idx] === multipliers[idx - 1])
        ? binarySearch(basePTs, current[idx - 1])  // 从 ≥ 前一 bp 开始
        : basePTs.length - 1;                        // 否则从最大开始
    if (startIdx < 0) return; // 前一 bp 不在集合中，不应发生

    // 从大到小遍历 basePT，优先匹配高 basePT（非 FULL 曲通常 PT 更高）
    for (let i = startIdx; i >= 0; i--) {
        const bp = basePTs[i];
        const contribution = bp * m;
        if (contribution + maxRest < remaining) break;
        if (contribution + minRest > remaining) continue;
        findAllAllocations(
            remaining - contribution,
            flameIndices, multipliers, idx + 1,
            [...current, bp],
            basePTs, solutions, maxSolutions,
        );
    }
}

// ─── main entry ───

const MAX_ALTERNATIVES = 100;

export function analyze(
    targetPT: number,
    activityType: ActivityType,
    config: TeamConfig,
    songMetadata: SongChartMeta,
    songList: MusicDataResponse,
    filter: SolutionFilter,
): AnalysisResult {
    // 收集固定PT歌曲（应用硬过滤）
    const { achievableBasePTs, songMap } = computeFixedBasePTs(config, activityType, songMetadata, songList, filter);
    const boostLevels = computeBoostLevelPTs(achievableBasePTs);

    // 如果没有固定PT歌曲
    if (achievableBasePTs.length === 0) {
        return {
            feasible: false,
            boostLevels,
            strategy: [],
            alternatives: [],
            maxAchievablePT: 0,
        };
    }

    const minBasePT = achievableBasePTs[0];
    const maxBasePT = achievableBasePTs[achievableBasePTs.length - 1];

    // 目标 PT 低于最小可达 basePT → 无论如何都达不到这么低
    if (targetPT < minBasePT) {
        return {
            feasible: false,
            boostLevels,
            strategy: [],
            alternatives: [],
            maxAchievablePT: maxBasePT * FLAME_MULTIPLIERS[3] * 5,
            targetTooLow: true,
        };
    }

    // 搜索：从最少把数开始
    let allSolutions: Strategy[] = [];
    for (let n = 1; n <= 5; n++) {
        allSolutions.push(...findAllSolutionsForN(targetPT, n, achievableBasePTs, MAX_ALTERNATIVES + 1));
        if (allSolutions.length >= MAX_ALTERNATIVES + 1) break;
    }

    if (allSolutions.length > 0) {
        // ─── 软过滤辅助函数 ───
        const hasBandSong = (s: Strategy): boolean => {
            if (!filter.bandEnabled || filter.bandMode !== "contains" || filter.bandId === null) return true;
            return s.basePTs.some((bp) => {
                const songs = songMap.get(bp);
                return songs?.some((sng) => sng.bandId === filter.bandId) ?? false;
            });
        };
        const boostScore = (s: Strategy): number => {
            if (!filter.boostEnabled || !filter.boostString) return 0;
            let matched = 0;
            for (const bp of s.basePTs) {
                const songs = songMap.get(bp);
                if (songs?.some((sng) => sng.matchesBoost)) matched++;
            }
            return s.basePTs.length > 0 ? matched / s.basePTs.length : 0;
        };
        // 每步可用歌曲数的几何平均数（边际递减，惩罚局部低值）
        const avgSongCount = (s: Strategy): number => {
            let product = 1;
            for (const bp of s.basePTs) {
                product *= (songMap.get(bp)?.length ?? 1);
            }
            return s.basePTs.length > 0
                ? Math.pow(product, 1 / s.basePTs.length)
                : 0;
        };

        // 排除不符合 band='contains' 的方案
        if (filter.bandEnabled && filter.bandMode === "contains" && filter.bandId !== null) {
            allSolutions = allSolutions.filter(hasBandSong);
        }

        // ─── 方案排序 ───
        allSolutions.sort((a, b) => {
            // 0. boostString 权重优先
            const bsA = boostScore(a);
            const bsB = boostScore(b);
            if (bsA !== bsB) return bsB - bsA;
            // 1. 游玩次数少优先
            if (a.totalPlays !== b.totalPlays) return a.totalPlays - b.totalPlays;
            // 2. 平均可用歌曲数多优先（= 选歌更灵活）
            const acA = avgSongCount(a);
            const acB = avgSongCount(b);
            if (acA !== acB) return acB - acA;
            // 3. 火焰总等级高优先（tiebreaker）
            const sumA = a.flameIndices.reduce((s, x) => s + x, 0);
            const sumB = b.flameIndices.reduce((s, x) => s + x, 0);
            return sumB - sumA;
        });

        // 限制总方案数
        if (allSolutions.length > MAX_ALTERNATIVES + 1) {
            allSolutions = allSolutions.slice(0, MAX_ALTERNATIVES + 1);
        }

        const main = allSolutions[0];
        const buildSteps = (s: Strategy): PlayStep[] =>
            s.flameIndices.map((fi, i) => {
                const bp = s.basePTs[i];
                const m = FLAME_MULTIPLIERS[fi];
                const songs = songMap.get(bp) ?? [];
                // 非 FULL 曲排前面
                const sorted = [...songs].sort((a, b) => {
                    const aFull = a.songName.includes("[FULL]") ? 1 : 0;
                    const bFull = b.songName.includes("[FULL]") ? 1 : 0;
                    return aFull - bFull;
                });
                return {
                    flames: fi,
                    multiplier: m,
                    basePT: bp,
                    boostedPT: bp * m,
                    songs: sorted,
                };
            });

        return {
            feasible: true,
            boostLevels,
            strategy: buildSteps(main),
            alternatives: allSolutions.slice(1).map(buildSteps),
        };
    }

    // ─── 不可行 ───
    const maxAchievablePT = maxBasePT * FLAME_MULTIPLIERS[3] * 5;

    // 加成建议：仅当 targetPT 在单局可达范围时（≤ 当前最大 basePT × 3火）展示
    // 因为加成控分表本质是"1局游戏的 PT 在什么加成下能打出来"
    let feasibleBonuses: AnalysisResult["feasibleBonuses"];
    const bonusParams = buildBonusParams(activityType, config);
    if (bonusParams && targetPT <= maxBasePT * FLAME_MULTIPLIERS[3]) {
        try {
            const bonuses = getFeasibleBonus(targetPT, bonusParams);
            if (bonuses.length > 0) {
                feasibleBonuses = bonuses;
            }
        } catch {
            // skip
        }
    }

    return {
        feasible: false,
        boostLevels,
        strategy: [],
        alternatives: [],
        feasibleBonuses,
        maxAchievablePT,
    };
}
