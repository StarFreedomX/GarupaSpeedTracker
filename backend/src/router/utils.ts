import { Server } from "@/types/bestdori";

/**
 * Coerces an unknown query value to a number.
 *
 * Returns `NaN` when the value is an array (ambiguous), otherwise delegates to
 * `Number()` conversion.
 */
export const queryToNumber = (value: unknown): number => {
    if (Array.isArray(value)) {
        return Number.NaN;
    }

    return Number(value);
};

/**
 * Coerces an optional query value to a number.
 *
 * Returns `undefined` when the value itself is `undefined`, otherwise delegates to
 * {@link queryToNumber}.
 */
export const queryToOptionalNumber = (value: unknown): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    return queryToNumber(value);
};

/**
 * Converts an unknown query value to a trimmed string.
 *
 * Returns `undefined` for arrays, `null`, `undefined`, or empty/whitespace-only strings.
 * Trims surrounding whitespace from non-empty values.
 */
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

/**
 * Type guard: checks whether a numeric value is a valid {@link Server} enum member.
 */
export const isServer = (value: number): value is Server => [Server.jp, Server.en, Server.tw, Server.cn, Server.kr].includes(value);

/**
 * Creates a structured validation error with HTTP 422 status.
 *
 * @param field - The name of the field that failed validation.
 * @param message - Human-readable error message.
 */
export const validationError = (field: string, message: string) => {
    const error = new Error("Validation Failed") as Error & { status?: number; errors?: unknown[] };
    error.status = 422;
    error.errors = [{ message, code: "invalid", field }];
    return error;
};
