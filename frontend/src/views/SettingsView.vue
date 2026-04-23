<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { clonePreferences, normalizeHue } from "@/composables/useUserPreferences";
import {
    DEFAULT_AUTO_RETRY_DELAY_SECONDS,
    DEFAULT_REQUEST_INTERVAL_SECONDS,
    DEFAULT_REQUEST_MINUTE_INTERVAL,
    DEFAULT_REQUEST_SECOND,
    DEFAULT_SAMPLE_INTERVAL_SECONDS,
    DEFAULT_TABLE_PREFERENCES,
} from "@/config/config";
import { useI18n } from "@/i18n";
import { normalizeApiBase } from "@/services/apiBase";
import type { UserPreferences } from "@/types/preferences";
import type { ServerKey } from "@/types/score";

const { t } = useI18n();
const model = defineModel<UserPreferences>({ required: true });

const clampNumber = (value: number, fallback: number, min: number, max?: number): number => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    const next = Math.round(value);
    const lower = Math.max(min, next);
    return max === undefined ? lower : Math.min(lower, max);
};

const draft = reactive(clonePreferences(model.value));

const syncDraft = (next: UserPreferences) => {
    const copy = clonePreferences(next);
    Object.assign(draft.api, copy.api);
    Object.assign(draft.query, copy.query);
    Object.assign(draft.table, copy.table);
    Object.assign(draft.theme, copy.theme);
};

watch(
    model,
    (next) => {
        syncDraft(next);
    },
    { deep: true, immediate: true },
);

const serverOptions: Array<{ value: ServerKey; label: string }> = [
    { value: 0, label: "JP" },
    { value: 1, label: "EN" },
    { value: 2, label: "TW" },
    { value: 3, label: "CN" },
    { value: 4, label: "KR" },
];

const sampleIntervalSeconds = computed({
    get: () => draft.query.sampleIntervalSeconds,
    set: (value: number) => {
        draft.query.sampleIntervalSeconds = clampNumber(value, DEFAULT_SAMPLE_INTERVAL_SECONDS, 1);
    },
});

const requestIntervalSeconds = computed({
    get: () => draft.query.requestIntervalSeconds,
    set: (value: number) => {
        draft.query.requestIntervalSeconds = clampNumber(value, DEFAULT_REQUEST_INTERVAL_SECONDS, 1);
    },
});

const requestMinuteInterval = computed({
    get: () => draft.query.requestMinuteInterval,
    set: (value: number) => {
        draft.query.requestMinuteInterval = clampNumber(value, DEFAULT_REQUEST_MINUTE_INTERVAL, 1);
    },
});

const requestSecond = computed({
    get: () => draft.query.requestSecond,
    set: (value: number) => {
        draft.query.requestSecond = clampNumber(value, DEFAULT_REQUEST_SECOND, 0, 59);
    },
});

const requestAutoRetryDelaySeconds = computed({
    get: () => draft.query.requestAutoRetryDelaySeconds,
    set: (value: number) => {
        draft.query.requestAutoRetryDelaySeconds = clampNumber(value, DEFAULT_AUTO_RETRY_DELAY_SECONDS, 1);
    },
});

const isFrontendApiMode = computed(() => draft.api.mode === "frontend");
const isSmartRefreshMode = computed(() => draft.query.requestMode === "smart-refresh");

const apiBackendBaseUrl = computed({
    get: () => draft.api.backendBaseUrl,
    set: (value: string) => {
        draft.api.backendBaseUrl = value;
    },
});

const isApiBackendBaseUrlValid = computed(() => draft.api.mode === "frontend" || draft.api.backendBaseUrl.trim().length > 0);

const rowsPerPage = computed({
    get: () => draft.table.rowsPerPage,
    set: (value: number) => {
        draft.table.rowsPerPage = clampNumber(value, DEFAULT_TABLE_PREFERENCES.rowsPerPage, 1);
    },
});

const queryTime = computed({
    get: () => draft.query.time,
    set: (value: number) => {
        draft.query.time = clampNumber(value, draft.query.time, 2);
    },
});

const hueValue = computed(() => normalizeHue(draft.theme.primaryHue));
const hasChanges = computed(() => JSON.stringify(clonePreferences(draft)) !== JSON.stringify(clonePreferences(model.value)));
const isFixedIntervalMode = computed(() => draft.query.requestMode === "fixed-interval");

const save = () => {
    const next = clonePreferences(draft);
    next.api.backendBaseUrl = normalizeApiBase(next.api.backendBaseUrl);

    Object.assign(model.value.api, next.api);
    Object.assign(model.value.query, next.query);
    Object.assign(model.value.table, next.table);
    Object.assign(model.value.theme, next.theme);
};

const onHueChange = (event: Event) => {
    draft.theme.primaryHue = normalizeHue(Number((event.target as HTMLInputElement).value));
};
</script>

<template>
    <section class="grid max-w-3xl grid-cols-1 gap-4">
        <section class="app-panel grid grid-cols-1 gap-4 p-4">
            <h2 class="text-base font-semibold">{{ t('settings.queryTitle') }}</h2>

            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label class="grid gap-1 text-sm text-muted">
                    {{ t('filters.server') }}
                    <select v-model.number="draft.query.server"
                            class="rounded-app border-border bg-surface text-sm text-text">
                        <option v-for="option in serverOptions" :key="option.value" :value="option.value">
                            {{ option.label }}
                        </option>
                    </select>
                </label>

                <label class="grid gap-1 text-sm text-muted">
                    {{ t('settings.sampleInterval') }}
                    <input v-model.number="sampleIntervalSeconds" type="number" min="1"
                           class="rounded-app border-border bg-surface text-sm text-text"/>
                </label>

                <label class="grid gap-1 text-sm text-muted">
                    {{ t('filters.timeWindow') }}
                    <input v-model.number="queryTime" type="number" min="2"
                           class="rounded-app border-border bg-surface text-sm text-text"/>
                </label>
            </div>
        </section>

        <section class="app-panel grid grid-cols-1 gap-4 p-4">
            <h2 class="text-base font-semibold">{{ t('settings.requestTitle') }}</h2>

            <fieldset class="grid justify-items-start gap-3 text-sm text-muted">
                <legend class="text-sm font-medium text-text">{{ t('settings.requestMode') }}</legend>

                <label class="inline-flex w-fit cursor-pointer items-center gap-2">
                    <input v-model="draft.query.requestMode" type="radio" value="fixed-interval"/>
                    <span>{{ t('settings.requestModeFixedInterval') }}</span>
                </label>

                <label class="inline-flex w-fit cursor-pointer items-center gap-2">
                    <input v-model="draft.query.requestMode" type="radio" value="fixed-minute"/>
                    <span>{{ t('settings.requestModeFixedMinute') }}</span>
                </label>

                <label class="inline-flex w-fit cursor-pointer items-center gap-2">
                    <input v-model="draft.query.requestMode" type="radio" value="smart-refresh"/>
                    <span>{{ t('settings.requestModeSmartRefresh') }}</span>
                </label>
            </fieldset>

            <Transition
                mode="out-in"
                enter-active-class="transition-opacity transition-transform duration-[180ms] ease"
                leave-active-class="transition-opacity transition-transform duration-[180ms] ease"
                enter-from-class="opacity-0 translate-y-1"
                enter-to-class="opacity-100 translate-y-0"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 translate-y-1"
            >
                <div :key="draft.query.requestMode" class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <template v-if="isFixedIntervalMode">
                        <label class="grid gap-1 text-sm text-muted">
                            {{ t('settings.requestIntervalSeconds') }}
                            <input v-model.number="requestIntervalSeconds" type="number" min="1"
                                   class="rounded-app border-border bg-surface text-sm text-text"/>
                        </label>
                    </template>

                    <template v-else-if="draft.query.requestMode === 'fixed-minute'">
                        <label class="grid gap-1 text-sm text-muted">
                            {{ t('settings.requestMinuteInterval') }}
                            <input v-model.number="requestMinuteInterval" type="number" min="1"
                                   class="rounded-app border-border bg-surface text-sm text-text"/>
                        </label>

                        <label class="grid gap-1 text-sm text-muted">
                            {{ t('settings.requestSecond') }}
                            <input v-model.number="requestSecond" type="number" min="0" max="59"
                                   class="rounded-app border-border bg-surface text-sm text-text"/>
                        </label>
                    </template>

                    <template v-else-if="isSmartRefreshMode">
                        <label class="grid gap-1 text-sm text-muted">
                            {{ t('settings.requestAutoRetryDelaySeconds') }}
                            <input
                                v-model.number="requestAutoRetryDelaySeconds"
                                type="number"
                                min="1"
                                class="rounded-app border-border bg-surface text-sm text-text"
                            />
                        </label>

                        <p class="md:col-span-2 text-sm text-muted">
                            {{ t('settings.requestModeSmartRefreshHint') }}
                        </p>
                    </template>
                </div>
            </Transition>
        </section>

        <section class="app-panel grid grid-cols-1 gap-4 p-4">
            <h2 class="text-base font-semibold">{{ t('settings.apiTitle') }}</h2>

            <fieldset class="grid justify-items-start gap-3 text-sm text-muted">
                <legend class="text-sm font-medium text-text">{{ t('settings.apiMode') }}</legend>

                <label class="inline-flex w-fit cursor-pointer items-center gap-2">
                    <input v-model="draft.api.mode" type="radio" value="frontend"/>
                    <span>{{ t('settings.apiModeFrontend') }}</span>
                </label>

                <label class="inline-flex w-fit cursor-pointer items-center gap-2">
                    <input v-model="draft.api.mode" type="radio" value="backend"/>
                    <span>{{ t('settings.apiModeBackend') }}</span>
                </label>
            </fieldset>

            <Transition
                mode="out-in"
                enter-active-class="transition-opacity transition-transform duration-[180ms] ease"
                leave-active-class="transition-opacity transition-transform duration-[180ms] ease"
                enter-from-class="opacity-0 translate-y-1"
                enter-to-class="opacity-100 translate-y-0"
                leave-from-class="opacity-100 translate-y-0"
                leave-to-class="opacity-0 translate-y-1"
            >
                <div :key="draft.api.mode" class="grid gap-2">
                    <p v-if="isFrontendApiMode" class="text-sm text-muted">
                        {{ t('settings.apiFrontendDescription') }}
                    </p>

                    <label v-else class="grid gap-1 text-sm text-muted max-w-xl">
                        {{ t('settings.apiBackendBaseUrl') }}
                        <input
                            v-model.trim="apiBackendBaseUrl"
                            type="url"
                            :placeholder="t('settings.apiBackendPlaceholder')"
                            class="rounded-app border-border bg-surface text-sm text-text"
                        />
                        <span
                            class="text-xs"
                            :class="isApiBackendBaseUrlValid ? 'text-muted' : 'text-red-500'"
                        >
              {{ isApiBackendBaseUrlValid ? t('settings.apiBackendHint') : t('settings.apiBackendRequired') }}
            </span>
                    </label>

                    <p v-if="!isFrontendApiMode" class="text-xs text-muted">
                        {{ t('settings.apiCorsHint') }}
                    </p>
                </div>
            </Transition>
        </section>

        <section class="app-panel grid grid-cols-1 gap-4 p-4">
            <h2 class="text-base font-semibold">{{ t('settings.tableTitle') }}</h2>

            <label class="grid gap-1 text-sm text-muted max-w-xs">
                {{ t('settings.rowsPerPage') }}
                <input v-model.number="rowsPerPage" type="number" min="1"
                       class="rounded-app border-border bg-surface text-sm text-text"/>
            </label>
        </section>

        <section class="app-panel grid grid-cols-1 gap-4 p-4">
            <div class="flex items-center justify-between gap-3">
                <h2 class="text-base font-semibold">{{ t('settings.title') }}</h2>
                <div class="flex items-center gap-2 text-sm text-muted">
          <span
              class="inline-flex h-7 min-w-11 items-center justify-center rounded-app bg-surface/80 px-2 font-semibold text-text ring-1 ring-border/70">
            {{ hueValue }}
          </span>
                </div>
            </div>

            <label class="grid gap-2 text-sm text-muted">
                {{ t('settings.hue') }}
                <span class="theme-hue-slider-wrap">
          <input
              type="range"
              min="0"
              max="360"
              step="5"
              :value="hueValue"
              class="theme-hue-slider"
              @input="onHueChange"
          />
        </span>
            </label>
        </section>

        <div class="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-border/80 bg-appbg/92 px-4 py-3 backdrop-blur-lg">
            <div class="flex items-center justify-end gap-3">
                <button
                    type="button"
                    class="app-btn border border-border/80 bg-surface/90 px-4 py-2 text-sm text-text transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="!hasChanges || !isApiBackendBaseUrlValid"
                    @click="save"
                >
                    {{ t('settings.save') }}
                </button>
            </div>
        </div>
    </section>
</template>

