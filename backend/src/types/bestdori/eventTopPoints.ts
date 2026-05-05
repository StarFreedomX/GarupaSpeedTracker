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

export interface BestdoriTopPointsRaw {
    points: BestdoriPointRaw[];
    users: BestdoriUserRaw[];
}

export interface PointsWithTs {
    time: number;
    points: number;
}

export interface PlayerPointsData {
    uid: number;
    points: PointsWithTs[];
    info: {
        name: string;
        introduction: string;
    };
}

export type PointsTrackResponse = PlayerPointsData[];

export enum Server {
    jp = 0,
    en = 1,
    tw = 2,
    cn = 3,
    kr = 4,
}

export interface PointsQueryParams {
    server: Server;
    eventId: number;
    interval: number;
    time: number;
    lastTimeStamp?: number;
}
