/**
 * 国服 RID 缓存污染响应校验
 *
 * **背景**：国服的 RID 可能被游戏客户端抢走消费，导致程序拿到其他请求的缓存数据。
 * 本模块利用国服活动榜必定有 1500 档线、月榜没有 1500 档线的特性做数据校验。
 *
 * **这是一个临时外挂模块**，独立于 parser，方便日后替换或移除。
 * 仅对 CN server (index 3) 执行校验。
 */
import type { EventRankingBandoriRaw } from "@/types/event";
import type { MonthlyRankingBandoriRaw } from "@/types/monthlyRanking";

const CN_SERVER = 3;

interface ValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * 检查 border users 列表中是否存在指定 tier 的用户
 */
function hasTier(users: Array<{ tier: number }> | undefined, targetTier: number): boolean {
    if (!users || users.length === 0) return false;
    return users.some((u) => u.tier === targetTier);
}

/**
 * 校验活动排名响应
 *
 * 逻辑：
 * - 有 tier=1500 → 对
 * - 没有 1500，但有 tier=2000 → 一定是月榜数据，拒绝
 * - 两者都没有 → 无法判断，通过
 */
export function validateEventRanking(report: EventRankingBandoriRaw, server: number): ValidationResult {
    if (server !== CN_SERVER) {
        return { valid: true };
    }

    const borderUsers = report.eventPointBorderUsers;
    const has1500 = hasTier(borderUsers, 1500);
    const has2000 = hasTier(borderUsers, 2000);

    if (has1500) {
        return { valid: true };
    }

    if (has2000) {
        return { valid: false, reason: "border has tier=2000 but not 1500, likely monthly ranking data" };
    }

    // 两个都没有 → 可能是 border 还没数据，或者 story 类型
    return { valid: true };
}

/**
 * 校验月榜排名响应
 *
 * 逻辑：
 * - 有 tier=1500 → 一定是活动榜数据，拒绝
 * - 没有 → 通过
 */
export function validateMonthlyRanking(report: MonthlyRankingBandoriRaw, server: number): ValidationResult {
    if (server !== CN_SERVER) {
        return { valid: true };
    }

    const borderUsers = report.monthlyRankingPointBorderUsers;
    const has1500 = hasTier(borderUsers, 1500);

    if (has1500) {
        return { valid: false, reason: "border has tier=1500, likely event ranking data" };
    }

    return { valid: true };
}
