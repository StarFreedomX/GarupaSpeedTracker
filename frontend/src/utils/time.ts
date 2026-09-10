import { ref } from "vue";
import type { DisplayTimeZone } from "@/types/preferences";

export const displayTimeZone = ref<DisplayTimeZone>("local");
const formatters = new Map<string, Intl.DateTimeFormat>();

function dateParts(timestamp: number, timeZone = displayTimeZone.value): Record<string, string> {
    // Resolve local zone each time so a system timezone change is also respected.
    const zone = timeZone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
    let formatter = formatters.get(zone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat("en-GB", {
            timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
        });
        formatters.set(zone, formatter);
    }
    return Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]));
}

export const formatHm = (timestamp: number): string => {
    const p = dateParts(timestamp);
    return `${p.hour}:${p.minute}`;
};
export const formatTime = (timestamp: number): string => {
    const p = dateParts(timestamp);
    return `${p.hour}:${p.minute}:${p.second}`;
};
export const formatDateTime = (timestamp: number): string => {
    const p = dateParts(timestamp);
    return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
};
export const formatShortDateTime = (timestamp: number, seconds = true): string => {
    const p = dateParts(timestamp);
    return `${p.month}/${p.day} ${p.hour}:${p.minute}${seconds ? `:${p.second}` : ""}`;
};

/** Floor to the selected zone's hour, including local half/quarter-hour offsets. */
export const floorDisplayHour = (timestamp: number): number => {
    const p = dateParts(timestamp);
    return timestamp - Number(p.minute) * 60_000 - Number(p.second) * 1000 - ((timestamp % 1000 + 1000) % 1000);
};

export const toMs = (timestamp: number): number => (timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp);
