import type { Skill, SongLevelSummary } from "@/types/songMetadata";

/** 4-bit binary encoding denominator (smmm/16). */
const ENCODE_DENOM = 16;

export type FpsOption = 60 | 120;

/**
 * Decode a 4-bit binary-encoded note count.
 * Encoding: integer part = 120fps count, fractional part = (smmm)/16.
 *   s = sign (0=+, 1=-), mmm = |60fps - 120fps|.
 */
function decodeNoteCount(value: number, fps: FpsOption): number {
    const count120 = Math.floor(value);
    if (fps === 120) return count120;
    // 60fps: decode diff from fractional part
    const binaryValue = Math.round((value - count120) * ENCODE_DENOM);
    const sign = (binaryValue >> 3) & 1;
    const magnitude = binaryValue & 0b0111;
    const diff = sign === 0 ? magnitude : -magnitude;
    return count120 + diff;
}

/**
 * 计算技能在覆盖 noteCount 个Note时的近似权重，用于 findExtremes 回溯搜索。
 *
 * - 普通技能：noteCount × scoreUp
 * - 叠p技能：Σ(k=1..noteCount) min(scoreUp + k × stepRate, maxCap)
 *
 * 注意：这里不含 floor 和 baseAutoScore，精确分数由 calcExactScoreInTurns 计算。
 */
function computeSkillWeight(skill: Skill, noteCount: number): number {
    const prog = skill.progressive;
    if (!prog) {
        return noteCount * skill.scoreUp;
    }
    const { stepRate, maxCap } = prog;
    let sum = 0;
    for (let k = 1; k <= noteCount; k++) {
        sum += Math.min(skill.scoreUp + k * stepRate, maxCap);
    }
    return sum;
}

/**
 * 精确计算技能在覆盖 noteCount 个Note时的得分（含 floor）。
 *
 * 使用整数缩放避免浮点精度问题。
 * - 普通技能：noteCount × ⌊ baseAutoScore × (1 + scoreUp) ⌋
 * - 叠p技能：Σ(k=1..noteCount) ⌊ baseAutoScore × (1 + min(scoreUp + k × stepRate, maxCap)) ⌋
 *
 * SCALE = 1,000,000，支持到 0.0001% 精度（远高于游戏实际需求）。
 */
const PROGRESSIVE_SCALE = 1_000_000;

function computeSkillScore(baseAutoScore: number, skill: Skill, noteCount: number): number {
    const prog = skill.progressive;
    if (!prog) {
        return noteCount * Math.floor(baseAutoScore * (1 + skill.scoreUp));
    }
    const { stepRate, maxCap } = prog;
    // 将浮点数转为整数，避免 k × stepRate 的累积浮点误差
    const scoreUpScaled = Math.round(skill.scoreUp * PROGRESSIVE_SCALE);
    const stepRateScaled = Math.round(stepRate * PROGRESSIVE_SCALE);
    const maxCapScaled = Math.round(maxCap * PROGRESSIVE_SCALE);

    let score = 0;
    for (let k = 1; k <= noteCount; k++) {
        const bonusScaled = Math.min(scoreUpScaled + k * stepRateScaled, maxCapScaled);
        score += Math.floor((baseAutoScore * (PROGRESSIVE_SCALE + bonusScaled)) / PROGRESSIVE_SCALE);
    }
    return score;
}

/**
 * 计算分数并返回
 *
 * AUTO分数计算方法:
 *
 * 基础自动分数 = ⌊ 3 * autoPara * 队伍综合力 * (1+(歌曲等级-5)%) / 歌曲总Note数 ⌋
 *
 * 单个Note分数 = ⌊ 基础自动分数  * (1 + 技能加成倍率) ⌋
 *
 * 歌曲总分 = 单个Note分数之和
 * @param totalPower 队伍综合力
 * @param skills 技能组
 * @param centerSkill 队长技能
 * @param songLevelSummary 谱面数据
 * @param autoPara auto倍率参数
 */
export function calcScore(
    totalPower: number,
    skills: Skill[],
    centerSkill: Skill,
    songLevelSummary: SongLevelSummary,
    autoPara: number,
    fps: FpsOption = 120,
): { maxScore: number; minScore: number; maxPath: number[]; minPath: number[] } {
    const { counts, overlaps } = songLevelSummary;

    /**
     * 动态计算单个 (skill, position) 的 note 数（含排队偏移）
     * 回溯时还不知道前一个技能是谁，用 null 表示"未确定"
     */
    const getNoteCount = (skill: Skill, pos: number, prevSkill: Skill | null): number => {
        let notes = decodeNoteCount(counts[skill.duration]?.[pos] ?? 0, fps);
        if (pos > 0 && prevSkill && overlaps?.[pos]) {
            const deltaEncoded = overlaps[pos]?.[prevSkill.duration]?.[skill.duration];
            if (deltaEncoded !== undefined) {
                notes += decodeNoteCount(deltaEncoded, fps);
            }
        }
        return notes;
    };

    // 回溯搜索（5! = 120 排列，剪枝无必要，直接穷举）
    const { max, min } = findExtremes(skills, (skill, pos, prevSkill) => {
        return computeSkillWeight(skill, getNoteCount(skill, pos, prevSkill));
    });

    /**
     * 精算：根据粗筛出来的 Path，带入原本的精确公式计算
     * Path 格式: path[skillIdx] = posIdx
     */
    const getExactScore = (path: number[]) => {
        const orderedSkills = new Array(5);
        path.forEach((posIdx, skillIdx) => {
            orderedSkills[posIdx] = skills[skillIdx];
        });
        return calcExactScoreInTurns(totalPower, [...orderedSkills, centerSkill], songLevelSummary, autoPara, fps);
    };

    return {
        maxScore: getExactScore(max.path),
        minScore: getExactScore(min.path),
        maxPath: max.path,
        minPath: min.path,
    };
}

/**
 * 根据传入的技能数组（已排好序）和队长索引计算分数
 * @param totalPower 队伍综合力
 * @param skills 当前顺序下的技能组（长度为 5+1）
 * @param songLevelSummary 谱面数据
 * @param autoPara auto倍率参数
 */
export function calcExactScoreInTurns(totalPower: number, skills: Skill[], songLevelSummary: SongLevelSummary, autoPara: number, fps: FpsOption = 120): number {
    const songLevel = songLevelSummary.level;
    // 1. 计算基础自动分数 (整数)
    const baseAutoScore = Math.floor((3 * autoPara * totalPower * (1 + (songLevel - 5) / 100)) / songLevelSummary.total);

    let totalScore = 0;
    let totalCoveredNotes = 0;

    // 遍历 6 个技能触发时段 (0-5)
    for (let i = 0; i < 6; i++) {
        // 技能来源判定：
        // 前 5 个时段直接对应传入数组的顺序：skills[0...4]
        // 第 6 个时段固定取队长技能：skills[5]
        const skill = skills[i];

        // 技能覆盖的后续 Note (decoded from 4-bit binary encoding for the selected fps)
        let notesAfterTrigger = decodeNoteCount(songLevelSummary.counts[skill.duration]?.[i] ?? 0, fps);

        // 技能排队偏移修正：当两个连续触发点间隔 < 8.8s 时，后技能可能被排队延迟
        if (i > 0 && songLevelSummary.overlaps?.[i]) {
            const prevDuration = skills[i - 1].duration;
            const deltaEncoded = songLevelSummary.overlaps[i]?.[prevDuration]?.[skills[i].duration];
            if (deltaEncoded !== undefined) {
                notesAfterTrigger += decodeNoteCount(deltaEncoded, fps);
            }
        }
        totalScore += computeSkillScore(baseAutoScore, skill, notesAfterTrigger);

        // 累计消耗的物量
        totalCoveredNotes += notesAfterTrigger;
    }

    // 计算未被技能覆盖的剩余 Note
    const remainingNotes = songLevelSummary.total - totalCoveredNotes;
    if (remainingNotes > 0) {
        totalScore += remainingNotes * baseAutoScore;
    }

    return totalScore;
}

/**
 * 寻找技能分配的最优解（即最大分数/最小分数）。
 * 5 个技能分配到位置 0-4，全排列 5! = 120，直接枚举。
 *
 * @param skills 五个技能的数组（队长的位置固定是 5，不在排列内）
 * @param weightFn (skill, position, prevSkill | null) → 该位置的得分权重
 *   prevSkill 为位置 pos-1 的技能，pos=0 时为 null
 */
function findExtremes(
    skills: Skill[],
    weightFn: (skill: Skill, pos: number, prevSkill: Skill | null) => number,
): { max: { score: number; path: number[] }; min: { score: number; path: number[] } } {
    const n = skills.length;

    let maxScore = Number.NEGATIVE_INFINITY;
    let minScore = Number.POSITIVE_INFINITY;
    let bestMaxPath: number[] = new Array(n).fill(-1);
    let bestMinPath: number[] = new Array(n).fill(-1);

    const currentPath = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    // ordered[pos] = Skill，回溯过程中按位填充，作为 prevSkill 传递给下一行
    const ordered = new Array(n).fill(null) as (Skill | null)[];

    function backtrack(pos: number, currentSum: number) {
        if (pos === n) {
            if (currentSum > maxScore) { maxScore = currentSum; bestMaxPath = [...currentPath]; }
            if (currentSum < minScore) { minScore = currentSum; bestMinPath = [...currentPath]; }
            return;
        }

        const prevSkill = pos > 0 ? ordered[pos - 1] : null;

        for (let si = 0; si < n; si++) {
            if (used[si]) continue;

            used[si] = true;
            currentPath[si] = pos;
            ordered[pos] = skills[si];

            const weight = weightFn(skills[si], pos, prevSkill);
            backtrack(pos + 1, currentSum + weight);

            ordered[pos] = null;
            currentPath[si] = -1;
            used[si] = false;
        }
    }

    backtrack(0, 0);
    return {
        max: { score: maxScore, path: bestMaxPath },
        min: { score: minScore, path: bestMinPath },
    };
}
