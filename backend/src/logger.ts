export function logger(type: string, message: unknown): void {
    const timeString = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`[${timeString}] [${type}] ${String(message)}`);
}
