export type ServerKey = 0 | 1 | 2 | 3 | 4;

export interface ScorePoint {
    time: number;
    points: number;
}

export interface PlayerInfo {
    name: string;
    introduction: string;
}

export interface PlayerTrack {
    uid: number;
    points: ScorePoint[];
    info: PlayerInfo;
}

export type LegacyScoreResponse = Record<number, Omit<PlayerTrack, "uid">>;
export type ScoreResponse = PlayerTrack[] | LegacyScoreResponse;

export interface ScoreQuery {
    server: ServerKey;
    event: number;
    time: number;
    interval?: number;
    lastTimeStamp?: number;
}

export interface TableCell {
    display: string;
    points: number;
}

export interface TableRow {
    time: number;
    label: string;
    cells: Record<number, TableCell>;
}

export interface TableModel {
    players: PlayerTrack[];
    rows: TableRow[];
}
