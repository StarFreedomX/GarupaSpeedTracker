import { describe, expect, it } from "vitest";
import type { EventListResponse } from "@/types/event";
import { buildEventOptions, selectBestEventId } from "./eventSelection";

const payload: EventListResponse = {
    "1": {
        eventType: "mission_live",
        eventName: ["Alpha", null, null, null, null],
        assetBundleName: "alpha",
        startAt: ["9000", null, null, null, null],
        endAt: ["11000", null, null, null, null],
    },
    "2": {
        eventType: "mission_live",
        eventName: ["Beta", null, null, null, null],
        assetBundleName: "beta",
        startAt: ["12000", null, null, null, null],
        endAt: ["13000", null, null, null, null],
    },
    "3": {
        eventType: "mission_live",
        eventName: ["Gamma", null, null, null, null],
        assetBundleName: "gamma",
        startAt: ["7000", null, null, null, null],
        endAt: ["8000", null, null, null, null],
    },
};

describe("eventSelection", () => {
    it("sorts event options by startAt proximity to now", () => {
        const options = buildEventOptions(payload, 0, 10_000);

        expect(options.map((option) => option.eventId)).toEqual([1, 2, 3]);
        expect(options[0].label.startsWith("1 - Alpha (")).toBe(true);
    });

    it("prefers the currently active event when one is available", () => {
        const options = buildEventOptions(payload, 0, 10_000);

        expect(selectBestEventId(options, 10_000)).toBe(1);
    });

    it("falls back to the nearest startAt when no event is active", () => {
        const options = buildEventOptions(payload, 0, 14_000);

        expect(selectBestEventId(options, 14_000)).toBe(2);
    });

    it("respects a valid preferred event id when provided", () => {
        const options = buildEventOptions(payload, 0, 14_000);

        expect(selectBestEventId(options, 14_000, 3)).toBe(3);
    });
});
