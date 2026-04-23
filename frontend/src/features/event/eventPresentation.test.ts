import { describe, expect, it } from "vitest";
import { getEventBannerUrl } from "./eventPresentation";

describe("eventPresentation", () => {
    it("builds the Bestdori banner url from server index and asset bundle name", () => {
        expect(getEventBannerUrl(0, "mebaeta_omoi")).toBe("https://bestdori.com/assets/jp/event/mebaeta_omoi/images_rip/banner.png");
    });

    it("returns undefined when asset bundle name is missing", () => {
        expect(getEventBannerUrl(0, "")).toBeUndefined();
    });
});
