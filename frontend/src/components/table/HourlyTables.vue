<script setup lang="ts">
import { formatShortDateTime } from "@/utils/time";
import { computed } from "vue";
import { toHourlySnapshots } from "@/features/points/hourlyMath";
import { useI18n } from "@/i18n";
import type { EventOption } from "@/types/event";
import type { PlayerTrack } from "@/types/points";

const props = defineProps<{ tracks: PlayerTrack[]; event?: EventOption; loading: boolean }>();
const { t } = useI18n();
const snapshots = computed(() => toHourlySnapshots(props.tracks, props.event?.startAt, props.event?.endAt));
const columns = ["rank", "player", "points", "gap", "speed", "speedRank", "changes", "firstBlank", "lastBlank", "average"] as const;
const number = (value: number | null) => value === null ? "—" : value.toLocaleString();
</script>

<template>
    <section class="min-w-0" :aria-busy="loading">
        <h1 class="mb-3 text-lg font-semibold">{{ t('hourly.title') }}</h1>
        <p v-if="!snapshots.length" class="app-panel p-6 text-center text-sm text-muted">
            {{ loading ? t('common.loading') : t('hourly.empty') }}
        </p>
        <div class="grid min-w-0 gap-8">
            <article v-for="snapshot in snapshots" :key="snapshot.hour" class="min-w-0 overflow-hidden rounded-app border border-border bg-surface/90">
                <header class="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/10 px-4 py-3">
                    <h2 class="font-semibold tabular-nums">{{ formatShortDateTime(snapshot.hour, false) }}</h2>
                    <span v-if="snapshot.partial" class="text-xs text-muted">{{ t('hourly.partial') }}</span>
                    <p class="text-xs tabular-nums text-muted">{{ formatShortDateTime(snapshot.start) }} → {{ formatShortDateTime(snapshot.end) }}</p>
                </header>
                <div class="overflow-x-auto" tabindex="0" :aria-label="t('hourly.title')">
                    <table class="w-full whitespace-nowrap text-right text-sm tabular-nums">
                        <thead class="bg-primary/5 text-xs text-muted">
                            <tr><th v-for="column in columns" :key="column" scope="col" class="px-4 py-3 font-medium" :class="column === 'player' ? 'text-left' : ''">{{ t(`hourly.${column}`) }}</th></tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in snapshot.rows" :key="row.uid" class="border-t border-border/60 hover:bg-primary/5">
                                <td class="px-4 py-3 text-muted">{{ row.rank }}</td>
                                <th scope="row" class="max-w-64 px-4 py-3 text-left font-medium">
                                    <div class="truncate" :title="row.name">{{ row.name }}</div>
                                    <div class="mt-1 text-xs font-normal text-muted">UID {{ row.uid }}</div>
                                </th>
                                <td class="px-4 py-3">{{ number(row.points) }}</td>
                                <td class="px-4 py-3 text-muted">{{ number(row.gap) }}</td>
                                <td class="px-4 py-3 font-semibold text-primary">{{ number(row.speed) }}</td>
                                <td class="px-4 py-3">{{ number(row.speedRank) }}</td>
                                <td class="px-4 py-3">{{ number(row.changes) }}</td>
                                <td class="px-4 py-3 text-muted">{{ number(row.firstBlank) }}</td>
                                <td class="px-4 py-3 text-muted">{{ number(row.lastBlank) }}</td>
                                <td class="px-4 py-3">{{ number(row.average) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </article>
        </div>
    </section>
</template>
