<script setup lang="ts">
import { useI18n } from "@/i18n";
import type { EventOption } from "@/types/event";
import type { QueryPreferences } from "@/types/preferences";

const model = defineModel<QueryPreferences>({ required: true });
const props = defineProps<{
    eventOptions: EventOption[];
    loading: boolean;
}>();
const { t } = useI18n();
</script>

<template>
    <section class="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(20rem,1fr)] lg:items-end lg:justify-start">
        <label class="flex flex-col gap-1 text-xs text-muted">
            {{ t('filters.event') }}
            <select
                v-model.number="model.event"
                class="rounded-app border-border bg-surface px-2 py-1 text-sm text-text"
                :disabled="props.loading || props.eventOptions.length === 0"
            >
                <option v-if="props.loading" :value="model.event">{{ t('filters.eventLoading') }}</option>
                <option v-else-if="props.eventOptions.length === 0" :value="model.event">{{
                        t('filters.eventEmpty')
                    }}
                </option>
                <option v-for="option in props.eventOptions" :key="option.eventId" :value="option.eventId">
                    {{ option.label }}
                </option>
            </select>
        </label>

        <span class="text-xs text-muted">{{ t('filters.advancedInSettings') }}</span>
    </section>
</template>


