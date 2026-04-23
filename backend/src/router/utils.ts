import { Server } from "@/types/bestdori";

export const queryToNumber = (value: unknown): number => {
    if (Array.isArray(value)) {
        return Number.NaN;
    }

    return Number(value);
};

export const queryToOptionalNumber = (value: unknown): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    return queryToNumber(value);
};

export const queryToString = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
        return undefined;
    }

    if (value === undefined || value === null) {
        return undefined;
    }

    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
};

export const isServer = (value: number): value is Server => [Server.jp, Server.en, Server.tw, Server.cn, Server.kr].includes(value);

export const validationError = (field: string, message: string) => {
    const error = new Error("Validation Failed") as Error & { status?: number; errors?: unknown[] };
    error.status = 422;
    error.errors = [{ message, code: "invalid", field }];
    return error;
};
