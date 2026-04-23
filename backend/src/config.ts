import dotenv from "dotenv";

// Prefer local overrides first, then fallback to shared env defaults.
dotenv.config({ path: [".env.local", ".env", ".env.example"] });

const toNumber = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean): boolean => {
    if (value === undefined) {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
};

export const BESTDORI_API = process.env.BESTDORI_API ?? "https://bestdori.com/api/";

export const HOST = process.env.HOST ?? "127.0.0.1";
export const PORT = toNumber(process.env.PORT, 5519);
export const API_PREFIX = process.env.API_PREFIX ?? "/api";

// Seconds: if newest Bestdori point is newer than this threshold, reuse cache.
export const MIN_UPDATE_TIME = toNumber(process.env.MIN_UPDATE_TIME, 45);

export const BESTDORI_TIMEOUT_MS = toNumber(process.env.BESTDORI_TIMEOUT_MS, 10_000);

export const DEFAULT_INTERVAL = 30_000;

export const ENABLE_CORS = toBoolean(process.env.ENABLE_CORS, false);
export const APP_PROXY = toBoolean(process.env.APP_PROXY, false);
