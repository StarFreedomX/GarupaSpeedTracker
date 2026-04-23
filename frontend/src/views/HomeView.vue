<script setup lang="ts">
import { computed } from "vue";
import EventSummaryPanel from "@/components/event/EventSummaryPanel.vue";
import ScoreFilters from "@/components/filters/ScoreFilters.vue";
import ScoreTable from "@/components/table/ScoreTable.vue";
import { toTableModel } from "@/features/score/scoreMath";
import { useI18n } from "@/i18n";
import type { EventOption } from "@/types/event";
import type { QueryPreferences } from "@/types/preferences";
import type { PlayerTrack } from "@/types/score";

const props = defineProps<{
    filters: QueryPreferences;
    tracks: PlayerTrack[];
    rowsPerPage: number;
    loading: boolean;
    eventLoading: boolean;
    eventOptions: EventOption[];
    error: string;
    paused: boolean;
    countdownSeconds: number;
}>();

const emit = defineEmits<{
    (event: "refresh"): void;
    (event: "toggle-pause"): void;
    (event: "update:filters", value: QueryPreferences): void;
}>();

const filterModel = computed({
    get: () => props.filters,
    set: (value: QueryPreferences) => emit("update:filters", value),
});

const { t } = useI18n();

const tableModel = computed(() => toTableModel(props.tracks));
const selectedEvent = computed(() => props.eventOptions.find((option) => option.eventId === props.filters.event));
</script>

<template>
    <div class="grid gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2">
            <ScoreFilters
                v-model="filterModel"
                :event-options="props.eventOptions"
                :loading="props.eventLoading"
            />
            <div class="flex items-center gap-2">

                <button
                    type="button"
                    class="app-btn border border-border/80 bg-surface/90 px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="props.loading"
                    @click="emit('refresh')"
                >
                    {{ t('topbar.refresh') }}
                </button>
                <button
                    type="button"
                    class="app-btn border border-border/80 px-3 py-1.5 text-sm"
                    :class="props.paused ? 'bg-primary/12 text-text' : 'bg-surface/90 text-muted'"
                    @click="emit('toggle-pause')"
                >
                    {{ props.paused ? t('topbar.resumeAuto') : t('topbar.pauseAuto') }}
                    {{ props.paused ? '' : `(${ props.countdownSeconds }s)` }}
                </button>
            </div>
        </div>


        <EventSummaryPanel :event="selectedEvent" :loading="props.eventLoading"/>

        <p v-if="props.error" class="border border-border/80 bg-surface px-3 py-2 text-sm text-muted">
            {{ props.error }}
        </p>

        <ScoreTable :model="tableModel" :loading="props.loading" :rows-per-page="props.rowsPerPage"/>
        <!-- 页脚 -->
        <footer class="mt-10 text-center text-xs text-gray-400">
            <div class="text-center text-xs text-gray-400 mb-2 mt-4">
                {{ t('home.footerThanks') }}
                <a href="https://bestdori.com" target="_blank" rel="noopener" class="underline hover:text-blue-500">Bestdori</a>
                {{ t('home.footerDataProvided') }}
            </div>
            <a href="https://github.com/StarFreedomX/GarupaSpeedTracker" target="_blank" rel="noopener"
               class="underline hover:text-blue-500">
                {{ t('home.footerGitHub') }}
            </a>
        </footer>
    </div>
</template>




