import type { ServerKey } from "@/types/points";

export type RequestMode = "fixed-interval" | "fixed-minute" | "smart-refresh";
export type DisplayTimeZone = "local" | "Asia/Shanghai" | "Asia/Tokyo";

export type ApiMode = "frontend" | "backend";

export interface ApiPreferences {
    mode: ApiMode;
    backendBaseUrl: string;
}

export interface QueryPreferences {
    server: ServerKey;
    event: number;
    sampleIntervalSeconds: number;
    requestMode: RequestMode;
    requestIntervalSeconds: number;
    requestMinuteInterval: number;
    requestSecond: number;
    requestAutoRetryDelaySeconds: number;
    time: number;
}

export interface TablePreferences {
    rowsPerPage: number;
}

export interface ThemePreferences {
    primaryHue: number;
}

export interface CalculatorPreferences {
    minRecPower: number;
    maxRecPower: number;
}

export interface UserPreferences {
    timeZone: DisplayTimeZone;
    api: ApiPreferences;
    query: QueryPreferences;
    table: TablePreferences;
    theme: ThemePreferences;
    calculator: CalculatorPreferences;
}
