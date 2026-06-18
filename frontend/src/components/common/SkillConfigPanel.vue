<script setup lang="ts">
import { sanitizeDecimalInput } from "@/composables/inputFilters";
import { useI18n } from "@/i18n";
import type { Skill } from "@/types/songMetadata";
import SkillDurationPicker from "./SkillDurationPicker.vue";

const { t } = useI18n();

defineProps<{
    skills: Skill[];
    centerIndex: number;
}>();

const emit = defineEmits<{
    (e: "update:skill", index: number, field: keyof Skill, value: string | number): void;
    (e: "update:centerIndex", value: number): void;
    (e: "update:skillProgressiveToggle", index: number, enabled: boolean): void;
    (e: "update:skillProgressive", index: number, field: "stepRate" | "maxCap", value: number): void;
    (e: "reset"): void;
}>();
</script>

<template>
    <div class="rounded border border-border/80 bg-surface/50 p-3">
        <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-medium">{{ t('auto.config.skillConfig') }}</span>
            <button
                type="button"
                class="text-xs text-muted hover:text-text"
                @click="emit('reset')"
            >
                {{ t('common.resetDefault') }}
            </button>
        </div>

        <!-- Slot for extra filter options (e.g. "show only fixed PT" checkbox) -->
        <slot name="extra-options" />

        <div class="space-y-2">
            <div class="text-xs font-medium text-muted">{{ t('auto.config.skillOrderHint') }}</div>
            <div class="grid gap-2">
                <div v-for="(skill, idx) in skills" :key="idx" class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <div class="flex items-center gap-1 shrink-0">
                            <input
                                type="radio"
                                :checked="centerIndex === idx"
                                class="h-3.5 w-3.5"
                                @change="emit('update:centerIndex', idx)"
                            />
                            <span
                                class="w-6 text-xs"
                                :class="centerIndex === idx ? 'text-primary' : 'text-muted'"
                            >
                                {{ idx + 1 }}
                            </span>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <SkillDurationPicker
                                :model-value="skill.duration"
                                class="w-24 sm:w-28"
                                @update:model-value="emit('update:skill', idx, 'duration', $event)"
                            />
                            <span class="hidden sm:inline text-xs text-muted">{{ t('common.unitSecond') }}</span>
                        </div>
                        <input
                            :value="skill.scoreUp"
                            type="text"
                            inputmode="decimal"
                            class="no-spin w-20 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 py-1.5 text-sm text-left"
                            @input="sanitizeDecimalInput"
                            @blur="(e) => {
                                const num = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(num)) emit('update:skill', idx, 'scoreUp', num);
                            }"
                        />
                        <span class="shrink-0 text-xs text-muted">{{ t('auto.config.skillRateLabel') }}</span>
                        <label class="flex shrink-0 items-center gap-1 text-xs text-muted cursor-pointer select-none">
                            <input
                                type="checkbox"
                                :checked="!!skill.progressive"
                                class="h-3 w-3"
                                @change="emit('update:skillProgressiveToggle', idx, ($event.target as HTMLInputElement).checked)"
                            />
                            {{ t('auto.config.progressiveToggle') }}
                        </label>
                    </div>
                    <div v-if="skill.progressive" class="mt-1 flex items-center gap-1.5 ml-14">
                        <span class="shrink-0 text-xs text-muted">{{ t('auto.config.progressiveStepRate') }}</span>
                        <input
                            :value="skill.progressive.stepRate"
                            type="text"
                            inputmode="decimal"
                            class="no-spin w-20 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 py-1.5 text-sm text-left"
                            @input="sanitizeDecimalInput"
                            @blur="(e) => {
                                const num = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(num)) emit('update:skillProgressive', idx, 'stepRate', num);
                            }"
                        />
                        <span class="shrink-0 text-xs text-muted">{{ t('auto.config.progressiveMaxCap') }}</span>
                        <input
                            :value="skill.progressive.maxCap"
                            type="text"
                            inputmode="decimal"
                            class="no-spin w-20 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 py-1.5 text-sm text-left"
                            @input="sanitizeDecimalInput"
                            @blur="(e) => {
                                const num = parseFloat((e.target as HTMLInputElement).value);
                                if (!isNaN(num)) emit('update:skillProgressive', idx, 'maxCap', num);
                            }"
                        />
                    </div>
                </div>
            </div>
        </div>

        <div class="mt-2 text-xs text-muted">
            <p>{{ t('auto.config.skillNote') }}</p>
            <span class="text-primary">● {{ t('auto.config.skillCenterHint') }}</span>
        </div>
    </div>
</template>
