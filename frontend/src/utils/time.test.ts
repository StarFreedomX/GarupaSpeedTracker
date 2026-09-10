import { afterEach, describe, expect, it, vi } from "vitest";
import { displayTimeZone, floorDisplayHour, formatDateTime, formatHm, formatShortDateTime } from "./time";

afterEach(() => { displayTimeZone.value = "local"; vi.restoreAllMocks(); });
describe("display time zone", () => {
    it("switches Beijing and Japan across midnight", () => {
        const time = Date.UTC(2026, 8, 10, 15, 30, 12);
        displayTimeZone.value = "Asia/Shanghai";
        expect(formatDateTime(time)).toBe("2026/09/10 23:30:12");
        displayTimeZone.value = "Asia/Tokyo";
        expect(formatDateTime(time)).toBe("2026/09/11 00:30:12");
        expect(formatHm(time)).toBe("00:30");
        expect(formatShortDateTime(time, false)).toBe("09/11 00:30");
        expect(floorDisplayHour(time)).toBe(Date.UTC(2026, 8, 10, 15));
    });
    it("follows a local zone with a quarter-hour offset", () => {
        const original = Intl.DateTimeFormat.prototype.resolvedOptions;
        vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
            return { ...original.call(this), timeZone: "Asia/Kathmandu" };
        });
        const time = Date.UTC(2026, 8, 10, 10, 30, 12, 345);
        expect(formatHm(time)).toBe("16:15");
        expect(floorDisplayHour(time)).toBe(Date.UTC(2026, 8, 10, 10, 15));
    });
});
