import { getApiBase } from "@/services/apiBase";
import type { ServerKey } from "@/types/points";

/** 与后端 PlayerDeckStatusResult 对应 */
export interface PlayerDeckStatusResult {
    eventType: string;
    eventName: string;
    eventId: number | null;
    publishTotalDeckPowerFlg: boolean;
    normalPower: number;
    eventPower: number;
    autoPower: number;
    eventBonusPct: number;
    skills: CardSkillInfo[];
}

export interface CardSkillInfo {
    /** 技能加成百分比（如 150 = 150%） */
    bonusPercent: number;
    /** 技能持续时间（秒，如 7.0） */
    durationSeconds: number;
    /** 叠p 技能信息，null 表示非叠p */
    progressive: { stepRate: number; maxCap: number } | null;
}

export interface PlayerDeckQuery {
    server: ServerKey;
    playerId: number;
    eventId?: number;
}

/**
 * 调用后端获取玩家编队状态。
 * GET /api/playerDeckStatus?server={server}&playerId={playerId}&eventId={eventId}
 */
export async function fetchPlayerDeckStatus(query: PlayerDeckQuery): Promise<PlayerDeckStatusResult> {
    const params = new URLSearchParams({
        server: String(query.server),
        playerId: String(query.playerId),
    });
    if (query.eventId !== undefined) {
        params.set("eventId", String(query.eventId));
    }

    const response = await fetch(`${getApiBase()}/playerDeckStatus?${params.toString()}`);
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `HTTP ${response.status}`);
    }
    return (await response.json()) as PlayerDeckStatusResult;
}
