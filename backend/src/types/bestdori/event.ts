export type BestdoriEventsAllRaw = Record<string, BestdoriEventRaw | undefined>;

export interface BestdoriEventRaw {
    eventType?: string | null;
    eventName?: Array<string | null>;
    assetBundleName?: string | null;
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
