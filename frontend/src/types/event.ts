import type { ServerKey } from "@/types/score";

export interface EventListItem {
    eventType: string | null;
    eventName: Array<string | null>;
    assetBundleName: string | null;
    startAt: Array<string | null>;
    endAt: Array<string | null>;
}

export type EventListResponse = Record<string, EventListItem>;

export interface EventOption {
    eventId: number;
    eventName: string;
    eventType: string | null;
    assetBundleName: string | null;
    startAt: number;
    endAt: number;
    label: string;
    server: ServerKey;
}
