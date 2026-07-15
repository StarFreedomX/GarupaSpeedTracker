<script setup lang="ts">
import { computed, ref } from "vue";
import type { Locale } from "@/i18n";
import { useI18n } from "@/i18n";

const props = defineProps<{
    status: string;
    lastUpdated: number | null;
}>();

const { locale, t, setLocale, availableLocales } = useI18n();

const updatedLabel = computed(() => {
    if (!props.lastUpdated) {
        return t("topbar.notSynced");
    }

    return new Date(props.lastUpdated).toLocaleTimeString();
});

const open = ref(false);

const selectLocale = (next: Locale) => {
    setLocale(next);
    open.value = false;
};
</script>

<template>
    <header class="topbar-rect flex items-center justify-between gap-3 px-3 py-2">
        <div class="flex items-center gap-3 pl-12">
            <div class="flex flex-col">
                <span class="text-sm font-semibold leading-5">{{ t('topbar.title') }}</span>
                <span class="text-xs text-muted leading-4">{{ t('topbar.status') }}: {{
                        status
                    }} | {{ t('topbar.lastUpdate') }}: {{ updatedLabel }}</span>
            </div>
        </div>

        <div class="relative shrink-0">
            <button
                class="flex items-center gap-1.5 rounded border border-muted px-2 py-1 text-xs text-muted transition-colors hover:border-primary hover:text-primary"
                title="Language"
                @click="open = !open"
            >
                <svg
                    class="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M2 12h20" />
                    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
                <svg
                    class="h-3 w-3 transition-transform"
                    :class="{ 'rotate-180': open }"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                >
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
                </svg>
            </button>

            <Teleport to="body">
                <div
                    v-if="open"
                    class="fixed inset-0 z-[100]"
                    @click="open = false"
                />
            </Teleport>

            <div
                v-if="open"
                class="absolute right-0 top-full z-[101] mt-1 min-w-[120px] overflow-hidden rounded border border-muted bg-appbg py-1 shadow-lg"
            >
                <button
                    v-for="opt in availableLocales"
                    :key="opt.locale"
                    class="block w-full px-3 py-1.5 text-left text-xs transition-colors"
                    :class="opt.locale === locale
                        ? 'bg-primary/15 font-medium text-primary'
                        : 'text-muted hover:bg-surface hover:text-text'"
                    @click="selectLocale(opt.locale)"
                >
                    {{ opt.label }}
                </button>
            </div>
        </div>
    </header>
</template>


