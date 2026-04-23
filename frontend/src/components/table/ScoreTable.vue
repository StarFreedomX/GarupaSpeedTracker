<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Tooltip from "@/components/common/Tooltip.vue";
import { useShiftWheelHorizontalScroll } from "@/composables/useShiftWheelHorizontalScroll";
import { useI18n } from "@/i18n";
import type { TableModel } from "@/types/score";
import { formatDateTime, toMs } from "@/utils/time";

const props = defineProps<{
    model: TableModel;
    loading: boolean;
    rowsPerPage: number;
}>();

const hasRows = computed(() => props.model.rows.length > 0 && props.model.players.length > 0);
const showScrollableTable = computed(() => hasRows.value || props.loading);
const { t } = useI18n();

const normalizedRowsPerPage = computed(() => Math.max(1, Math.trunc(Number(props.rowsPerPage) || 1)));
const totalPages = computed(() => Math.max(1, Math.ceil(props.model.rows.length / normalizedRowsPerPage.value)));
const hasPagination = computed(() => props.model.rows.length > normalizedRowsPerPage.value);

const currentPage = ref(1);
const pageJumpValue = ref("1");

const getPlayerCurrentScore = (player: TableModel["players"][number]): string => {
    for (let index = player.points.length - 1; index >= 0; index -= 1) {
        const point = player.points[index];
        if (point.points === -1) {
            continue;
        }

        const text = String(point.points);
        return index === player.points.length - 1 ? text : `(${text})`;
    }

    return "-";
};

const getPlayerTooltipContent = (player: TableModel["players"][number], score?: number | undefined): string => {
    const base = t("table.tooltipPlayerName", { name: player.info.name });
    const suffix = score !== undefined ? t("table.tooltipTotalScore", { score }) : undefined;
    return suffix ? `${base}\n${suffix}` : base;
};

const getTimeTooltipContent = (time: number): string => formatDateTime(toMs(time));

const activePage = computed(() => Math.min(Math.max(currentPage.value, 1), totalPages.value));

const visibleRows = computed(() => {
    const startIndex = (activePage.value - 1) * normalizedRowsPerPage.value;
    return props.model.rows.slice(startIndex, startIndex + normalizedRowsPerPage.value);
});

const topScrollRef = ref<HTMLDivElement | null>(null);
const tableScrollRef = ref<HTMLDivElement | null>(null);
const tableRef = ref<HTMLTableElement | null>(null);
const contentWidth = ref(0);

let resizeObserver: ResizeObserver | undefined;
let syncResetFrame = 0;
let isSyncingScroll = false;

const syncPageJumpValue = (page = activePage.value) => {
    pageJumpValue.value = String(page);
};

const scrollToPageTop = () => {
    const container = tableScrollRef.value;
    if (container) {
        container.scrollTop = 0;
    }
};

const clampPage = (page: number): number => Math.min(Math.max(Math.trunc(page), 1), totalPages.value);

const setCurrentPage = (page: number) => {
    const next = clampPage(page);
    currentPage.value = next;
    syncPageJumpValue(next);
    scrollToPageTop();
    void refreshMetrics();
};

const commitPageJump = () => {
    const parsed = Number(pageJumpValue.value);

    if (!Number.isFinite(parsed)) {
        syncPageJumpValue();
        return;
    }

    setCurrentPage(parsed);
};

const goToFirstPage = () => setCurrentPage(1);
const goToPreviousPage = () => setCurrentPage(activePage.value - 1);
const goToNextPage = () => setCurrentPage(activePage.value + 1);
const goToLastPage = () => setCurrentPage(totalPages.value);

const updateContentWidth = () => {
    const table = tableRef.value;
    if (!table) {
        return;
    }

    contentWidth.value = Math.ceil(Math.max(table.scrollWidth, table.getBoundingClientRect().width));
};

const alignTopScroll = () => {
    const top = topScrollRef.value;
    const bottom = tableScrollRef.value;

    if (!top || !bottom) {
        return;
    }

    top.scrollLeft = bottom.scrollLeft;
};

const refreshMetrics = async () => {
    await nextTick();
    updateContentWidth();
    alignTopScroll();
};

const syncScroll = (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target || isSyncingScroll) {
        return;
    }

    isSyncingScroll = true;
    target.scrollLeft = source.scrollLeft;

    if (syncResetFrame) {
        cancelAnimationFrame(syncResetFrame);
    }

    syncResetFrame = requestAnimationFrame(() => {
        isSyncingScroll = false;
    });
};

useShiftWheelHorizontalScroll(tableScrollRef);

const handleTopScroll = () => {
    syncScroll(topScrollRef.value, tableScrollRef.value);
};

const handleBottomScroll = () => {
    syncScroll(tableScrollRef.value, topScrollRef.value);
};

watch(
    showScrollableTable,
    (visible) => {
        if (visible) {
            void refreshMetrics();
        }
    },
    { immediate: true },
);

watch(
    () => props.model.players.length,
    () => {
        if (showScrollableTable.value) {
            void refreshMetrics();
        }
    },
);

watch(
    () => props.rowsPerPage,
    () => {
        currentPage.value = 1;
        syncPageJumpValue();

        if (showScrollableTable.value) {
            void refreshMetrics();
        }
    },
    { immediate: true },
);

watch(
    () => props.model.rows.length,
    () => {
        currentPage.value = Math.min(currentPage.value, totalPages.value);
        syncPageJumpValue();

        if (showScrollableTable.value) {
            void refreshMetrics();
        }
    },
    { immediate: true },
);

onMounted(() => {
    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
            updateContentWidth();
            alignTopScroll();
        });
    }
});

watch(
    tableRef,
    (next, prev) => {
        if (!resizeObserver) {
            return;
        }

        if (prev) {
            resizeObserver.unobserve(prev);
        }

        if (next) {
            resizeObserver.observe(next);
        }
    },
    { immediate: true },
);

onBeforeUnmount(() => {
    resizeObserver?.disconnect();

    if (syncResetFrame) {
        cancelAnimationFrame(syncResetFrame);
    }
});
</script>

<template>
    <section class="flex min-h-[420px] flex-col overflow-hidden border border-border/80 bg-surface/90">
        <div class="border-b border-border/80 bg-appbg/65 px-3 py-2 text-sm font-semibold">{{ t('table.title') }}</div>

        <div v-if="!showScrollableTable" class="grid grow place-items-center text-sm text-muted">
            {{ t('table.empty') }}
        </div>

        <div v-else class="flex grow min-h-0 flex-col">
            <div ref="topScrollRef"
                 class="table-scrollbar h-4 overflow-x-auto overflow-y-hidden border-b border-border/70 bg-appbg/70"
                 @scroll.passive="handleTopScroll">
                <div :style="{ width: `${contentWidth}px` }" class="h-px"></div>
            </div>

            <div
                ref="tableScrollRef"
                class="table-scroll grow overflow-auto"
                @scroll.passive="handleBottomScroll"
            >
                <table ref="tableRef" class="min-w-full border-collapse text-xs md:text-sm cursor-default">
                    <thead class="sticky top-0 z-10 bg-appbg/85 backdrop-blur-sm">
                    <tr>
                        <th class="sticky left-0 z-20 min-w-24 border-b border-r border-border/70 bg-appbg/85 px-2 py-1 text-left font-medium text-muted">
                            <span class="block text-[11px] leading-tight md:text-xs">{{ t('table.headerUid') }}</span>
                        </th>
                        <th
                            v-for="player in model.players"
                            :key="player.uid"
                            class="min-w-24 max-w-28 border-b border-r border-border/70 px-2 py-1 text-center font-medium"
                        >
                            <div class="truncate">{{ player.uid }}</div>
                        </th>
                    </tr>
                    <tr>
                        <th class="sticky left-0 z-20 min-w-24 border-b border-r border-border/70 bg-appbg/85 px-2 py-1 text-left font-medium text-muted">
                            <span class="block text-[11px] leading-tight md:text-xs">{{ t('table.headerName') }}</span>
                        </th>
                        <th
                            v-for="player in model.players"
                            :key="`${player.uid}-name`"
                            class="min-w-24 max-w-28 border-b border-r border-border/70 px-2 py-1 text-center font-medium"
                        >
                            <Tooltip :content="getPlayerTooltipContent(player)" class="block w-full">
                                <div class="truncate">{{ player.info.name }}</div>
                            </Tooltip>
                        </th>
                    </tr>
                    <tr>
                        <th class="sticky left-0 z-20 min-w-24 border-b border-r border-border/70 bg-appbg/85 px-2 py-1 text-left font-medium text-muted">
                            <span class="block text-[11px] leading-tight md:text-xs">{{ t('table.headerScore') }}</span>
                        </th>
                        <th
                            v-for="player in model.players"
                            :key="`${player.uid}-score`"
                            class="min-w-24 max-w-28 border-b border-r border-border/70 px-2 py-1 text-center font-medium"
                        >
                            <div class="truncate">{{ getPlayerCurrentScore(player) }}</div>
                        </th>
                    </tr>
                    </thead>

                    <tbody>
                    <tr v-for="row in visibleRows" :key="row.time" class="score-row hover:bg-primary/6">
                        <td class="sticky left-0 z-10 border-b border-r border-border/60 bg-surface px-2 py-2 font-medium">
                            <Tooltip :content="getTimeTooltipContent(row.time)" class="block w-full cursor-default">
                                <span>{{ row.label }}</span>
                            </Tooltip>
                        </td>
                        <td v-for="player in model.players" :key="`${row.time}-${player.uid}`"
                            class="border-b border-r border-border/60 px-2 py-2 text-center">
                            <Tooltip
                                v-if="row.cells[player.uid]?.points !== -1"
                                :content="getPlayerTooltipContent(player, row.cells[player.uid]?.points)"
                                class="inline-flex w-full cursor-default justify-center"
                            >
                                <span>{{ row.cells[player.uid]?.display ?? '-' }}</span>
                            </Tooltip>
                            <span v-else>{{ row.cells[player.uid]?.display ?? '-' }}</span>
                        </td>
                    </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="hasPagination" class="border-t border-border/70 bg-appbg/70 px-3 py-2 text-sm">
                <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div class="text-muted">{{
                            t('table.paginationSummary', { current: activePage, total: totalPages })
                        }}
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button"
                                class="app-btn border border-border/80 bg-surface/90 px-2 py-1 text-text disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="activePage === 1" @click="goToFirstPage">
                            {{ t('table.paginationFirst') }}
                        </button>
                        <button type="button"
                                class="app-btn border border-border/80 bg-surface/90 px-2 py-1 text-text disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="activePage === 1" @click="goToPreviousPage">
                            {{ t('table.paginationPrevious') }}
                        </button>

                        <label class="flex items-center gap-2 text-muted">
                            <span>{{ t('table.paginationPage') }}</span>
                            <input
                                v-model="pageJumpValue"
                                type="number"
                                min="1"
                                :max="totalPages"
                                class="w-20 rounded-app border-border bg-surface px-2 py-1 text-sm text-text"
                                @keydown.enter.prevent="commitPageJump"
                                @blur="commitPageJump"
                            />
                            <span>/ {{ totalPages }}</span>
                        </label>

                        <button type="button"
                                class="app-btn border border-border/80 bg-surface/90 px-2 py-1 text-text disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="activePage === totalPages" @click="goToNextPage">
                            {{ t('table.paginationNext') }}
                        </button>
                        <button type="button"
                                class="app-btn border border-border/80 bg-surface/90 px-2 py-1 text-text disabled:cursor-not-allowed disabled:opacity-50"
                                :disabled="activePage === totalPages" @click="goToLastPage">
                            {{ t('table.paginationLast') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>


