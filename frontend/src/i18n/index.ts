import { ref } from "vue";
import enUS from "@/i18n/messages/en-US";
import jaJP from "@/i18n/messages/ja-JP";
import type { I18nMessages } from "@/i18n/messages/schema";
import zhCN from "@/i18n/messages/zh-CN";

export type Locale = "zh-CN" | "en-US" | "ja-JP";

export interface LocaleOption {
    locale: Locale;
    /** 语言自身的名称，如 "English"、"中文" */
    label: string;
}

export const LOCALE_OPTIONS: LocaleOption[] = [
    { locale: "zh-CN", label: "简体中文" },
    { locale: "en-US", label: "English" },
    { locale: "ja-JP", label: "日本語" },
] as const;

const messages: Record<Locale, I18nMessages> = {
    "zh-CN": zhCN,
    "en-US": enUS,
    "ja-JP": jaJP,
};

const DEFAULT_LOCALE: Locale = "zh-CN";

const supportedLocales: Locale[] = LOCALE_OPTIONS.map((o) => o.locale);

const detectBrowserLocale = (): Locale => {
    if (typeof navigator === "undefined") return DEFAULT_LOCALE;

    const languages = navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];

    for (const lang of languages) {
        const normalized = lang.toLowerCase();
        // 精确匹配 "zh-CN"
        const exact = supportedLocales.find((l) => l.toLowerCase() === normalized);
        if (exact) return exact;

        // 主语言匹配 (ja → ja-JP, zh → zh-CN, en → en-US)
        const primary = normalized.split("-")[0];
        const match = supportedLocales.find((l) => l.toLowerCase().startsWith(primary));
        if (match) return match;
    }

    return DEFAULT_LOCALE;
};

const locale = ref<Locale>(detectBrowserLocale());

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
    let raw = pick(messages[locale.value], path);

    // 当前语言缺失或为空时，回退到默认语言
    if (raw === "" || raw === path) {
        const fallback = pick(messages[DEFAULT_LOCALE], path);
        if (fallback !== path) {
            raw = fallback;
        }
    }

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
        document.documentElement.lang = next;
    },
    availableLocales: LOCALE_OPTIONS,
});
