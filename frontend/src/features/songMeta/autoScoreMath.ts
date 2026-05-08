import type { Skill, SongLevelSummary } from "@/types/songMetadata";

/**
 * 计算分数并返回
 *
 * AUTO分数计算方法:
 *
 * 基础自动分数 = ⌊ 2.25 * 队伍综合力 * (1+(歌曲等级-5)%) / 歌曲总Note数 ⌋
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
): { maxScore: number; minScore: number; maxPath: number[]; minPath: number[] } {
    /**
     * 构造增量矩阵 (5x5)
     * 这里我们用简化模型：增量 = ⌊ 基础分 * 技能加成倍率 ⌋
     * 虽然 ⌊base * (1+up)⌋ 和 base + ⌊base * up⌋ 在数学上不完全相等，
     * 但对于“寻找最优顺序”这个任务来说，这个权重矩阵的单调性是足够的。
     */
    const bonusMatrix = skills.map((skill) => {
        const countsRow = songLevelSummary.counts[skill.duration];
        // 直接用 技能倍率 * Note数
        // 足以准确指引回溯算法找到最优路径
        return [0, 1, 2, 3, 4].map((posIdx) => (countsRow[posIdx] ?? 0) * skill.scoreUp);
    });

    // 粗筛：寻找最优/最劣的路径 (索引映射)
    const { max, min } = findExtremes(bonusMatrix);

    /**
     * 精算：根据粗筛出来的 Path，带入原本的精确公式计算
     * Path 格式: path[skillIdx] = posIdx
     */
    const getExactScore = (path: number[]) => {
        const orderedSkills = new Array(5);
        path.forEach((posIdx, skillIdx) => {
            orderedSkills[posIdx] = skills[skillIdx];
        });
        return calcExactScoreInTurns(totalPower, [...orderedSkills, centerSkill], songLevelSummary, autoPara);
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
 * @param skills 当前顺序下的技能组（长度为 5）
 * @param songLevelSummary 谱面数据
 * @param autoPara auto倍率参数
 */
export function calcExactScoreInTurns(totalPower: number, skills: Skill[], songLevelSummary: SongLevelSummary, autoPara: number): number {
    const songLevel = songLevelSummary.level;
    // 1. 计算基础自动分数 (整数)
    const baseAutoScore = Math.floor((3 * autoPara * totalPower * (1 + (songLevel - 5) / 100)) / songLevelSummary.total);

    let totalScore = 0;
    let totalCoveredNotes = 0;

    // 遍历 6 个技能触发时段 (0-5)
    for (let i = 0; i < 6; i++) {
        // 技能来源判定：
        // 前 5 个时段直接对应传入数组的顺序：skills[0...4]
        // 第 6 个时段固定取队长技能：skills[center]
        const skill = skills[i];

        // 技能覆盖的后续 Note：⌊ 基础自动分数 * (1 + 技能加成倍率) ⌋
        const notesAfterTrigger = songLevelSummary.counts[skill.duration]?.[i] ?? 0;
        const scoreWithSkill = Math.floor(baseAutoScore * (1 + skill.scoreUp));

        totalScore += notesAfterTrigger * scoreWithSkill;

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
 * 寻找技能分配的最优解（即最大分数/最小分数）
 * 使用回溯算法，配合剪枝优化
 * @param matrix
 */
function findExtremes(matrix: number[][]) {
    const n = matrix.length;

    // 初始化最大/最小状态
    let maxScore = Number.NEGATIVE_INFINITY;
    let minScore = Number.POSITIVE_INFINITY;
    let bestMaxPath: number[] = new Array(n).fill(-1);
    let bestMinPath: number[] = new Array(n).fill(-1);

    const currentPath = new Array(n).fill(-1);
    const usedCols = new Array(n).fill(false);

    // --- 预处理：潜力评估表 ---
    const rowMaxValues = matrix.map((row) => Math.max(...row));
    const rowMinValues = matrix.map((row) => Math.min(...row));

    const suffixMax = new Array(n + 1).fill(0);
    const suffixMin = new Array(n + 1).fill(0);

    for (let i = n - 1; i >= 0; i--) {
        suffixMax[i] = suffixMax[i + 1] + rowMaxValues[i];
        suffixMin[i] = suffixMin[i + 1] + rowMinValues[i];
    }

    function backtrack(row: number, currentSum: number) {
        if (row === n) {
            // 更新最大值
            if (currentSum > maxScore) {
                maxScore = currentSum;
                bestMaxPath = [...currentPath];
            }
            // 更新最小值
            if (currentSum < minScore) {
                minScore = currentSum;
                bestMinPath = [...currentPath];
            }
            return;
        }

        // 双向剪枝
        // 如果当前路径既不可能比 max 更大，也不可能比 min 更小
        // 那么这个分支才真正失去了搜索价值
        const potentialMax = currentSum + suffixMax[row];
        const potentialMin = currentSum + suffixMin[row];

        if (potentialMax <= maxScore && potentialMin >= minScore) {
            return;
        }

        for (let col = 0; col < n; col++) {
            if (!usedCols[col]) {
                usedCols[col] = true;
                currentPath[row] = col;

                backtrack(row + 1, currentSum + matrix[row][col]);

                usedCols[col] = false;
                currentPath[row] = -1;
            }
        }
    }

    backtrack(0, 0);
    return {
        max: { score: maxScore, path: bestMaxPath },
        min: { score: minScore, path: bestMinPath },
    };
}
