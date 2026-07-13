/**
 * Simple console logger with timestamp and category.
 *
 * @param type - Log category label (e.g. `"database"`, `"bestdori"`, `"cache"`).
 * @param message - The value to log, coerced to a string.
 */
export function logger(type: string, message: unknown): void {
    const timeString = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`[${timeString}] [${type}] ${String(message)}`);
}
