<script setup lang="ts">
import { sanitizeDecimalInput, sanitizeIntInput } from "@/composables/inputFilters";
import type { ActivityType } from "@/features/scoreControl/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const props = withDefaults(
    defineProps<{
        activityType: ActivityType;
        totalPower: number;
        supportBandPower: number;
        eventBonus: number;
        autoPara: number;
        autoPreset: "nonJp" | "jp" | "custom";
        fps: 60 | 120;
        showSupportBand: boolean;
        showEventBonus: boolean;
        activityTypeEditable?: boolean;
        activityTypeOptions: readonly { value: string; label: string }[];
    }>(),
    {
        activityTypeEditable: false,
        fps: 120,
    },
);

const emit = defineEmits<{
    (e: "update:activityType", value: ActivityType): void;
    (e: "update:totalPower", value: number): void;
    (e: "update:supportBandPower", value: number): void;
    (e: "update:eventBonus", value: number): void;
    (e: "update:autoPara", value: number): void;
    (e: "update:autoPreset", value: "nonJp" | "jp" | "custom"): void;
    (e: "update:fps", value: 60 | 120): void;
}>();

const AUTO_PRESETS = [
    { id: "nonJp", label: t("auto.server.nonJp"), value: 0.5 },
    { id: "jp", label: t("auto.server.jp"), value: 0.75 },
    { id: "custom", label: t("auto.server.custom"), value: null },
] as const;

const onAutoPresetChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as "nonJp" | "jp" | "custom";
    emit("update:autoPreset", value);
    const preset = AUTO_PRESETS.find((p) => p.id === value);
    if (preset?.value !== null && preset?.value !== undefined) {
        emit("update:autoPara", preset.value);
    }
};
</script>

<template>
    <div class="rounded border border-border/80 bg-surface/50 p-3">
        <div class="mb-2 text-sm font-medium">{{ t('auto.config.eventParams') }}</div>
        <div class="space-y-3">
            <!-- Activity type -->
            <div class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.eventType') }}</span>
                <select
                    v-if="activityTypeEditable"
                    :value="activityType"
                    class="flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @change="emit('update:activityType', ($event.target as HTMLSelectElement).value as ActivityType)"
                >
                    <option
                        v-for="opt in activityTypeOptions"
                        :key="opt.value"
                        :value="opt.value"
                    >
                        {{ opt.label }}
                    </option>
                </select>
                <span
                    v-else
                    class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                >
                    {{ activityTypeOptions.find(o => o.value === activityType)?.label }}
                </span>
            </div>

            <!-- Total power -->
            <div class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.totalPower') }}</span>
                <input
                    :value="totalPower"
                    type="text"
                    inputmode="numeric"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="sanitizeIntInput"
                    @blur="(e) => {
                        const num = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(num)) emit('update:totalPower', num);
                    }"
                />
            </div>
            <p class="mt-1 ml-[5.5rem] text-[10px] leading-none text-muted/60">{{ t('auto.config.totalPowerNote') }}</p>

            <!-- Support band -->
            <div v-if="showSupportBand" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.supportPower') }}</span>
                <input
                    :value="supportBandPower"
                    type="text"
                    inputmode="numeric"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="sanitizeIntInput"
                    @blur="(e) => {
                        const num = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(num)) emit('update:supportBandPower', num);
                    }"
                />
            </div>

            <!-- Event bonus -->
            <div v-if="showEventBonus" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.eventBonus') }}</span>
                <input
                    :value="eventBonus"
                    type="text"
                    inputmode="numeric"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="sanitizeIntInput"
                    @blur="(e) => {
                        const num = parseFloat((e.target as HTMLInputElement).value);
                        if (!isNaN(num)) emit('update:eventBonus', num);
                    }"
                />
            </div>

            <!-- Auto rate -->
            <div class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.autoRate') }}</span>
                <div class="flex min-w-0 gap-2">
                    <select
                        :value="autoPreset"
                        class="w-24 sm:w-28 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                        @change="onAutoPresetChange"
                    >
                        <option value="nonJp">{{ t('auto.server.nonJp') }}</option>
                        <option value="jp">{{ t('auto.server.jp') }}</option>
                        <option value="custom">{{ t('auto.server.custom') }}</option>
                    </select>
                    <input
                        v-if="autoPreset === 'custom'"
                        :value="autoPara"
                        type="text"
                        inputmode="decimal"
                        class="no-spin w-24 sm:w-28 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                        :placeholder="t('auto.config.ratePlaceholder')"
                        @input="sanitizeDecimalInput"
                        @blur="(e) => {
                            const num = parseFloat((e.target as HTMLInputElement).value);
                            if (!isNaN(num)) emit('update:autoPara', num);
                        }"
                    />
                    <span
                        v-else
                        class="w-24 sm:w-28 truncate rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                    >
                        {{ t('auto.config.rateLabel') }} {{ autoPara }}
                    </span>
                </div>
            </div>

            <!-- Frame rate -->
            <div class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.fps') }}</span>
                <select
                    :value="fps"
                    class="w-28 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @change="emit('update:fps', Number(($event.target as HTMLSelectElement).value) as 60 | 120)"
                >
                    <option :value="120">120 FPS</option>
                    <option :value="60">60 FPS</option>
                </select>
            </div>

            <!-- Slot for extra actions (e.g. calculate button) -->
            <slot name="actions" />
        </div>
    </div>
</template>
