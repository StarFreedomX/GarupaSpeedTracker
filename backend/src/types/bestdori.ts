export interface BestdoriPointRaw {
    time: number;
    uid: number;
    value: number;
}

export interface BestdoriUserRaw {
    uid: number;
    name: string;
    introduction: string;
    rank: number;
    sid: number;
    strained: number;
    degrees: number[];
}

export interface BestdoriResponseRaw {
    points: BestdoriPointRaw[];
    users: BestdoriUserRaw[];
}

export interface BestdoriEventRaw {
    eventType?: string | null;
    eventName?: Array<string | null>;
    assetBundleName?: string | null;
    startAt?: Array<string | null>;
    endAt?: Array<string | null>;
}

export type BestdoriEventsAllRaw = Record<string, BestdoriEventRaw | undefined>;

export interface EventListItem {
    eventType: string | null;
    eventName: Array<string | null>;
    assetBundleName: string | null;
    startAt: Array<string | null>;
    endAt: Array<string | null>;
}

export type EventListResponse = Record<string, EventListItem>;

export interface ScorePoint {
    time: number;
    points: number;
}

export interface PlayerScoreData {
    uid: number;
    points: ScorePoint[];
    info: {
        name: string;
        introduction: string;
    };
}

export type ScoreTrackResponse = PlayerScoreData[];

export enum Server {
    jp = 0,
    en = 1,
    tw = 2,
    cn = 3,
    kr = 4,
}

export interface ScoreQueryParams {
    server: Server;
    eventId: number;
    interval: number;
    time: number;
    lastTimeStamp?: number;
}
