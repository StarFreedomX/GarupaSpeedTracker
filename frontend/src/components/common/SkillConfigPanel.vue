<script setup lang="ts">
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
                <div v-for="(skill, idx) in skills" :key="idx" class="flex items-center gap-1.5 min-w-0">
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
                        type="number"
                        min="0"
                        step="0.01"
                        class="no-spin w-20 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 py-1.5 text-sm text-left"
                        @input="emit('update:skill', idx, 'scoreUp', parseFloat(($event.target as HTMLInputElement).value))"
                    />
                    <span class="shrink-0 text-xs text-muted">{{ t('auto.config.skillRateLabel') }}</span>
                </div>
            </div>
        </div>

        <div class="mt-2 text-xs text-muted">
            <p>{{ t('auto.config.skillNote') }}</p>
            <span class="text-primary">● {{ t('auto.config.skillCenterHint') }}</span>
        </div>
    </div>
</template>
