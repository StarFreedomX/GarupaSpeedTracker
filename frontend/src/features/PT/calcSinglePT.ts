// 定义各活动类型的参数类型
interface MissionParams {
    type: "mission";
    supportBandPower: number;
    // 百分比，如175表示175%加成
    eventBonus: number;
}

interface TryParams {
    type: "try";
    // 百分比，如75表示75%加成
    eventBonus: number;
}

interface ChallengeParams {
    type: "challenge";
    // 百分比，如50表示50%加成
    eventBonus: number;
}

interface VersusParams {
    type: "versus";
}

interface Solo5v5Params {
    type: "5v5";
}

interface Medley1Params {
    type: "medley1";
}

type EventParams = MissionParams | TryParams | ChallengeParams | VersusParams | Solo5v5Params | Medley1Params;

/**
 * 计算活动PT
 * @example
 * calcEventPT({ type: 'mission', score: 1130871, supportBandPower: 292582, eventBonus: 175 })
 * calcEventPT({ type: 'try', score: 2073694, eventBonus: 75 })
 * calcEventPT({ type: 'challenge', score: 1155987, eventBonus: 50 })
 * calcEventPT({ type: 'versus', score: 768929 })
 * calcEventPT({ type: '5v5', score: 1506235 })
 * calcEventPT({ type: 'medley1', score: 500000 })
 */
function calcEventPT(score: number, params: MissionParams): number;
function calcEventPT(score: number, params: TryParams): number;
function calcEventPT(score: number, params: ChallengeParams): number;
function calcEventPT(score: number, params: VersusParams): number;
function calcEventPT(score: number, params: Solo5v5Params): number;
function calcEventPT(score: number, params: Medley1Params): number;
function calcEventPT(score: number, params: EventParams): number {
    if (!params?.type) throw new Error("请传入活动类型");
    switch (params.type) {
        case "mission":
            // ⌊(120 + ⌊个人分数/15000⌋) * (1 + 活动加成) + ⌊支援乐队综合力/3000⌋⌋
            return Math.floor((120 + Math.floor(score / 15000)) * (1 + params.eventBonus / 100) + Math.floor(params.supportBandPower / 3000));
        case "try":
            // ⌊(130 + ⌊个人分数/26000⌋) * (1 + 活动加成)⌋
            return Math.floor((130 + Math.floor(score / 26000)) * (1 + params.eventBonus / 100));
        case "challenge":
            // ⌊(70 + ⌊个人分数/50000⌋) * (1 + 活动加成)⌋
            return Math.floor((70 + Math.floor(score / 50000)) * (1 + params.eventBonus / 100));
        case "versus":
            // 100 + ⌊个人分数/9750⌋
            return Math.floor(score / 9750) + 100;
        case "5v5":
            // 80 + ⌊个人分数/14000⌋
            return Math.floor(score / 14000) + 80;
        case "medley1":
            // 30 + ⌊个人分数/18500⌋
            return Math.floor(score / 18500) + 30;
        default:
            throw new Error(`不支持的活动类型: ${params}`);
    }
}

// -----------------------------------------------

/**
 * 分数范围结果
 */
interface ScoreRange {
    min: number; // 最小分数
    max: number; // 最大分数
}

/**
 * 根据活动PT反推分数范围
 * @param targetPT 目标活动PT
 * @param params 活动参数（与calcEventPT相同，不包含score）
 * @returns 分数范围 { min, max }
 *
 * @example
 * // 反推mission活动需要多少分才能达到633PT
 * getScoreRangeByPT(633, { type: 'mission', supportBandPower: 292582, eventBonus: 175 })
 * // 返回 { min: 1130851, max: 1131000 }
 *
 * @example
 * // 反推versus活动需要多少分才能达到178PT
 * getScoreRangeByPT(178, { type: 'versus' })
 * // 返回 { min: 760500, max: 770249 }
 */
function getScoreRangeByPT(targetPT: number, params: MissionParams | TryParams | ChallengeParams | VersusParams | Solo5v5Params | Medley1Params): ScoreRange {
    if (targetPT <= 0) throw new Error("目标PT必须大于0");

    switch (params.type) {
        case "mission": {
            // PT = floor((120 + floor(score/15000)) * (1 + bonus/100) + floor(support/3000))
            const { supportBandPower, eventBonus } = params;
            const supportPart = Math.floor(supportBandPower / 3000);
            const bonusMultiplier = 1 + eventBonus / 100;

            // 设 A = 120 + floor(score/15000)
            // targetPT = floor(A * bonusMultiplier + supportPart)
            // 所以 A * bonusMultiplier + supportPart ∈ [targetPT, targetPT + 1)
            // A ∈ [(targetPT - supportPart) / bonusMultiplier, (targetPT + 1 - supportPart) / bonusMultiplier)

            const minA = (targetPT - supportPart) / bonusMultiplier;
            const maxA = (targetPT + 1 - supportPart) / bonusMultiplier;

            if (maxA <= 120) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            const minAInt = Math.ceil(minA);
            const maxAInt = Math.ceil(maxA) - 1;

            if (minAInt > maxAInt) throw new Error(`目标PT ${targetPT} 无法精确达到`);

            // A = 120 + floor(score/15000)
            // floor(score/15000) = A - 120
            const minScoreDiv = minAInt - 120;
            const maxScoreDiv = maxAInt - 120;

            if (minScoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: minScoreDiv * 15000,
                max: (maxScoreDiv + 1) * 15000 - 1,
            };
        }

        case "try": {
            // PT = floor((130 + floor(score/26000)) * (1 + bonus/100))
            const { eventBonus } = params;
            const bonusMultiplier = 1 + eventBonus / 100;

            // 设 A = 130 + floor(score/26000)
            // targetPT = floor(A * bonusMultiplier)
            // A ∈ [targetPT / bonusMultiplier, (targetPT + 1) / bonusMultiplier)

            const minA = targetPT / bonusMultiplier;
            const maxA = (targetPT + 1) / bonusMultiplier;

            if (maxA <= 130) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            const minAInt = Math.ceil(minA);
            const maxAInt = Math.ceil(maxA) - 1;

            if (minAInt > maxAInt) throw new Error(`目标PT ${targetPT} 无法精确达到`);

            const minScoreDiv = minAInt - 130;
            const maxScoreDiv = maxAInt - 130;

            if (minScoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: minScoreDiv * 26000,
                max: (maxScoreDiv + 1) * 26000 - 1,
            };
        }

        case "challenge": {
            // PT = floor((70 + floor(score/50000)) * (1 + bonus/100))
            const { eventBonus } = params;
            const bonusMultiplier = 1 + eventBonus / 100;

            const minA = targetPT / bonusMultiplier;
            const maxA = (targetPT + 1) / bonusMultiplier;

            if (maxA <= 70) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            const minAInt = Math.ceil(minA);
            const maxAInt = Math.ceil(maxA) - 1;

            if (minAInt > maxAInt) throw new Error(`目标PT ${targetPT} 无法精确达到`);

            const minScoreDiv = minAInt - 70;
            const maxScoreDiv = maxAInt - 70;

            if (minScoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: minScoreDiv * 50000,
                max: (maxScoreDiv + 1) * 50000 - 1,
            };
        }

        case "versus": {
            // PT = 100 + floor(score/9750)
            // floor(score/9750) = PT - 100
            const scoreDiv = targetPT - 100;

            if (scoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: scoreDiv * 9750,
                max: (scoreDiv + 1) * 9750 - 1,
            };
        }

        case "5v5": {
            // PT = 80 + floor(score/14000)
            const scoreDiv = targetPT - 80;

            if (scoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: scoreDiv * 14000,
                max: (scoreDiv + 1) * 14000 - 1,
            };
        }

        case "medley1": {
            // PT = 30 + floor(score/18500)
            const scoreDiv = targetPT - 30;

            if (scoreDiv < 0) throw new Error(`目标PT ${targetPT} 太低，无法达到`);

            return {
                min: scoreDiv * 18500,
                max: (scoreDiv + 1) * 18500 - 1,
            };
        }

        default:
            throw new Error(`不支持的活动类型: ${(params as any).type}`);
    }
}

// 快捷函数：获取最小分数
function getMinScoreByPT(targetPT: number, params: MissionParams | TryParams | ChallengeParams | VersusParams | Solo5v5Params | Medley1Params): number {
    return getScoreRangeByPT(targetPT, params).min;
}

// 快捷函数：获取最大分数
function getMaxScoreByPT(targetPT: number, params: MissionParams | TryParams | ChallengeParams | VersusParams | Solo5v5Params | Medley1Params): number {
    return getScoreRangeByPT(targetPT, params).max;
}

// -------------------------------------

/**
 * 可行的加成值结果
 */
interface FeasibleBonusResult {
    bonus: number; // 加成值（百分比整数，如175表示175%）
    scoreRange: {
        min: number;
        max: number;
    };
}

/**
 * 通用：根据目标PT反推所有可行的加成值（仅支持有加成的活动类型）
 * @param targetPT 目标活动PT
 * @param params 活动参数（不包含eventBonus）
 * @returns 所有可行的加成值列表
 */
function getFeasibleBonus(
    targetPT: number,
    params: Omit<MissionParams, "eventBonus"> | Omit<TryParams, "eventBonus"> | Omit<ChallengeParams, "eventBonus">,
): FeasibleBonusResult[] {
    // 获取活动配置
    let base: number;
    let divisor: number;
    let supportPart = 0;

    switch (params.type) {
        case "mission":
            base = 120;
            divisor = 15000;
            supportPart = Math.floor(params.supportBandPower / 3000);
            break;
        case "try":
            base = 130;
            divisor = 26000;
            break;
        case "challenge":
            base = 70;
            divisor = 50000;
            break;
        default:
            throw new Error(`不支持的活动类型: ${params}`);
    }

    const results: FeasibleBonusResult[] = [];

    // 加成最低为0，此时 baseBeforeBonus = targetPT - supportPart
    // 因为 PT = floor(baseBeforeBonus * 1 + supportPart) = baseBeforeBonus + supportPart
    // 所以 baseBeforeBonus = targetPT - supportPart
    const maxBaseBeforeBonus = targetPT - supportPart;

    // 从最大的 baseBeforeBonus 往下找（分数越高，需要的加成越低）
    // scoreDiv = baseBeforeBonus - base
    for (let scoreDiv = Math.max(0, maxBaseBeforeBonus - base); scoreDiv >= 0; scoreDiv--) {
        const baseBeforeBonus = base + scoreDiv;

        // 如果 baseBeforeBonus 太大，即使 bonus=0 也会超过目标PT
        if (baseBeforeBonus + supportPart > targetPT) {
            continue;
        }

        // PT = floor(baseBeforeBonus * (1 + bonus/100) + supportPart)
        // 反推 bonus
        const minNeeded = (targetPT - supportPart) / baseBeforeBonus - 1;
        const maxNeeded = (targetPT + 1 - supportPart) / baseBeforeBonus - 1;

        const minBonus = Math.ceil(minNeeded * 100);
        const maxBonus = Math.floor(maxNeeded * 100 - 0.000001);

        if (minBonus <= maxBonus && minBonus >= 0) {
            for (let bonus = minBonus; bonus <= maxBonus; bonus++) {
                const actualPT = Math.floor(baseBeforeBonus * (1 + bonus / 100) + supportPart);
                if (actualPT === targetPT) {
                    const minScore = scoreDiv * divisor;
                    const maxScore = (scoreDiv + 1) * divisor - 1;

                    const existing = results.find((r) => r.bonus === bonus);
                    if (existing) {
                        existing.scoreRange.min = Math.min(existing.scoreRange.min, minScore);
                        existing.scoreRange.max = Math.max(existing.scoreRange.max, maxScore);
                    } else {
                        results.push({
                            bonus,
                            scoreRange: { min: minScore, max: maxScore },
                        });
                    }
                    break; // 同一个 scoreDiv 只会有一个 bonus 区间
                }
            }
        }
    }

    return results.sort((a, b) => a.bonus - b.bonus);
}

export { calcEventPT, getFeasibleBonus, getMaxScoreByPT, getMinScoreByPT, getScoreRangeByPT };
