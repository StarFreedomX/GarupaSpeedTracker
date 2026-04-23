import type { ServerKey } from "@/types/score";

const bestdoriServerCodes = ["jp", "en", "tw", "cn", "kr"] as const;

export const getEventBannerUrl = (server: ServerKey, assetBundleName?: string | null): string | undefined => {
    if (!assetBundleName) {
        return undefined;
    }

    return `https://bestdori.com/assets/${bestdoriServerCodes[server]}/event/${assetBundleName}/images_rip/banner.png`;
};
