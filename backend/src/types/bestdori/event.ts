export type BestdoriEventsAllRaw = Record<string, BestdoriEventRaw | undefined>;

export interface BestdoriEventRaw {
    eventType?: string | null;
    eventName?: Array<string | null>;
    assetBundleName?: string | null;
    startAt?: Array<string | null>;
    endAt?: Array<string | null>;
}

/** 完整活动数据（用于活动综合力计算） */
export interface BestdoriEventFullRaw {
    eventType: string;
    eventName: (string | null)[];
    attributes: Array<{ attribute: string; percent: number }>;
    characters: Array<{ characterId?: number; percent: number }>;
    members: Array<{ situationId?: number; percent: number }>;
    eventAttributeAndCharacterBonus?: { parameterPercent?: number; pointPercent?: number };
    eventCharacterParameterBonus?: { performance?: number; technique?: number; visual?: number };
    limitBreaks: Array<{ rarity: number; rank: number; percent: number }>;
    startAt?: Array<string | null>;
    endAt?: Array<string | null>;
}

export type EventListResponse = Record<string, EventListItem>;

export interface EventListItem {
    eventType: string | null;
    eventName: Array<string | null>;
    assetBundleName: string | null;
    startAt: Array<string | null>;
    endAt: Array<string | null>;
}
