import { ref } from "vue";
import enUS from "@/i18n/messages/en-US";
import type { I18nMessages } from "@/i18n/messages/schema";
import zhCN from "@/i18n/messages/zh-CN";

export type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, I18nMessages> = {
    "zh-CN": zhCN,
    "en-US": enUS,
};

const locale = ref<Locale>("zh-CN");

const pick = <T extends object>(tree: T, path: string): string => {
    const node = path.split(".").reduce<unknown>((acc, key) => {
        if (!acc || typeof acc === "string" || typeof acc !== "object") {
            return undefined;
        }
        return (acc as Record<string, unknown>)[key];
    }, tree);

    return typeof node === "string" ? node : path;
};

export const translate = (path: string, params?: Record<string, string | number>): string => {
    const raw = pick(messages[locale.value], path);
    if (!params) {
        return raw;
    }

    return Object.entries(params).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), raw);
};

export const useI18n = () => ({
    locale,
    t: translate,
    setLocale: (next: Locale) => {
        locale.value = next;
    },
});
