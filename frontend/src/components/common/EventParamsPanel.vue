<script setup lang="ts">
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
        autoPreset: "cn" | "jp" | "others";
        showSupportBand: boolean;
        showEventBonus: boolean;
        activityTypeEditable?: boolean;
        activityTypeOptions: readonly { value: string; label: string }[];
    }>(),
    {
        activityTypeEditable: false,
    },
);

const emit = defineEmits<{
    (e: "update:activityType", value: ActivityType): void;
    (e: "update:totalPower", value: number): void;
    (e: "update:supportBandPower", value: number): void;
    (e: "update:eventBonus", value: number): void;
    (e: "update:autoPara", value: number): void;
    (e: "update:autoPreset", value: "cn" | "jp" | "others"): void;
}>();

const AUTO_PRESETS = [
    { id: "cn", label: t("auto.server.cn"), value: 0.5 },
    { id: "jp", label: t("auto.server.jp"), value: 0.75 },
    { id: "others", label: t("auto.server.others"), value: null },
] as const;

const onAutoPresetChange = () => {
    const preset = AUTO_PRESETS.find((p) => p.id === props.autoPreset);
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
                    type="number"
                    min="0"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="emit('update:totalPower', Number(($event.target as HTMLInputElement).value))"
                />
            </div>
            <p class="mt-1 ml-[5.5rem] text-[10px] leading-none text-muted/60">{{ t('auto.config.totalPowerNote') }}</p>

            <!-- Support band -->
            <div v-if="showSupportBand" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.supportPower') }}</span>
                <input
                    :value="supportBandPower"
                    type="number"
                    min="0"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="emit('update:supportBandPower', Number(($event.target as HTMLInputElement).value))"
                />
            </div>

            <!-- Event bonus -->
            <div v-if="showEventBonus" class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.eventBonus') }}</span>
                <input
                    :value="eventBonus"
                    type="number"
                    min="0"
                    class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @input="emit('update:eventBonus', Number(($event.target as HTMLInputElement).value))"
                />
            </div>

            <!-- Auto rate -->
            <div class="flex items-center gap-3">
                <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.autoRate') }}</span>
                <div class="flex min-w-0 gap-2">
                    <select
                        :value="autoPreset"
                        class="w-24 sm:w-28 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                        @change="emit('update:autoPreset', ($event.target as HTMLSelectElement).value as 'cn' | 'jp' | 'others'); onAutoPresetChange()"
                    >
                        <option value="cn">{{ t('auto.server.cn') }}</option>
                        <option value="jp">{{ t('auto.server.jp') }}</option>
                        <option value="others">{{ t('auto.server.others') }}</option>
                    </select>
                    <input
                        v-if="autoPreset === 'others'"
                        :value="autoPara"
                        type="number"
                        min="0"
                        step="0.01"
                        class="no-spin w-24 sm:w-28 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                        :placeholder="t('auto.config.ratePlaceholder')"
                        @input="emit('update:autoPara', Number(($event.target as HTMLInputElement).value))"
                    />
                    <span
                        v-else
                        class="w-24 sm:w-28 truncate rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                    >
                        {{ t('auto.config.rateLabel') }} {{ autoPara }}
                    </span>
                </div>
            </div>

            <!-- Slot for extra actions (e.g. calculate button) -->
            <slot name="actions" />
        </div>
    </div>
</template>
