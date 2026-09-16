export type LogLevel = "info" | "success" | "warn" | "error";

const levelColors: Record<LogLevel, number> = { info: 36, success: 32, warn: 33, error: 31 };
const categoryColors = [36, 35, 34, 32, 96, 95, 94];

function supportsColor(): boolean {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== "0";
    return Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";
}

/** Timestamped, category-colored console output; redirected output stays plain text.
 * Pass an explicit level for failures and recoveries instead of inferring it from message text.
 */
export function logger(type: string, message: unknown, level: LogLevel = "info"): void {
    const timeString = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const useColor = supportsColor();
    const paint = (text: string, color: number): string => (useColor ? `\u001b[${color}m${text}\u001b[0m` : text);
    const hash = Array.from(type).reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    const timestamp = paint(`[${timeString}]`, 90);
    const category = paint(`[${type}]`, categoryColors[hash % categoryColors.length]);
    const label = paint(`[${level.toUpperCase()}]`, levelColors[level]);
    const text = level === "info" ? String(message) : paint(String(message), levelColors[level]);
    console.log(`${timestamp} ${category} ${label} ${text}`);
}
