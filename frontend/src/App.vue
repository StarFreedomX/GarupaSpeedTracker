<script setup lang="ts">
import Lenis from "lenis";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router"; // 引入路由钩子
import TopStatusBar from "@/components/layout/TopStatusBar.vue";
import SidebarMenu from "@/components/navigation/SidebarMenu.vue";
import { usePointsPolling } from "@/composables/usePointsPolling";
import { useUserPreferences } from "@/composables/useUserPreferences";
import { buildEventOptions, selectBestEventId } from "@/features/event/eventSelection";
import { useI18n } from "@/i18n";
import { setApiBase } from "@/services/apiBase";
import { fetchEventList } from "@/services/eventApi";
import type { EventOption } from "@/types/event";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const menuItems = computed(() => [
    { key: "home", label: t("menu.home") },
    { key: "interactive", label: t("menu.interactive") },
    { key: "auto", label: t("menu.auto") },
    { key: "bonus", label: t("menu.bonus") },
    { key: "settings", label: t("menu.settings") },
    { key: "about", label: t("menu.about") },
]);

const { preferences, applyTheme, persist } = useUserPreferences();
applyTheme(preferences.theme);
setApiBase(preferences.api);

// 使用当前路由名称作为激活状态
const activeMenu = computed(() => (route.name as string) || "auto");
const sidebarExpanded = ref(false);
const pageScrollRef = ref<HTMLElement | null>(null);
const pageContentRef = ref<HTMLElement | null>(null);

let lenis: Lenis | undefined;
let lenisFrame = 0;

const filters = preferences.query;
const eventOptions = ref<EventOption[]>([]);
const eventLoading = ref(false);
const eventReady = ref(false);
const hasResolvedInitialEvent = ref(false);
const eventBootstrapToken = ref(0);

// 路由跳转处理
const handleMenuSelect = (key: string) => {
    router.push({ name: key });
};
/*
const readEventIdFromUrl = (): number | undefined => {
    const raw = new URLSearchParams(window.location.search).get("event");
    if (raw === null) return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const replaceEventInUrl = (eventId: number): void => {
    // 使用 vue-router 的 replace 方法
    // 它会自动保留当前的路径(path)和哈希(hash)，只更新查询参数(query)
    router.replace({
        query: {
            ...route.query, // 保留现有的其他 query 参数
            event: String(eventId),
        },
    });
};

const initialUrlEventId = readEventIdFromUrl();
*/

const bootstrapEventOptions = async (_preferUrlEvent: boolean): Promise<void> => {
    const token = eventBootstrapToken.value + 1;
    eventBootstrapToken.value = token;
    eventLoading.value = true;
    eventReady.value = false;

    try {
        const payload = await fetchEventList();
        if (token !== eventBootstrapToken.value) return;

        const now = Date.now();
        const options = buildEventOptions(payload, filters.server, now);
        eventOptions.value = options;

        // 检查当前 filters.event 是否还在当前服务器的可选列表中
        const isCurrentEventValid = options.some((opt) => opt.eventId === filters.event);

        // 如果当前没有选活动，或者之前选的活动在当前服务器列表中找不到了（比如换了服务器）
        // 才自动计算并切换到“最佳/最新”活动
        if (!filters.event || !isCurrentEventValid) {
            const bestId = selectBestEventId(options, now);
            if (bestId) {
                filters.event = bestId;
            }
        }
    } catch {
        if (token === eventBootstrapToken.value) eventOptions.value = [];
    } finally {
        if (token === eventBootstrapToken.value) {
            eventLoading.value = false;
            eventReady.value = true;
            hasResolvedInitialEvent.value = true;
        }
    }
};

watch(
    () => filters.server,
    () => {
        // 移除 URL 优先级的判断
        void bootstrapEventOptions(false);
    },
    { immediate: true },
);
watch(
    () => preferences.theme,
    (next) => applyTheme(next),
    { deep: true },
);
watch(
    () => preferences.api,
    (next) => setApiBase(next),
    { deep: true, immediate: true },
);
watch(preferences, () => persist(), { deep: true });
/*
watch(
    () => filters.event,
    (next, previous) => {
        if (!eventReady.value || next === previous) return;
        replaceEventInUrl(next);
    },
);*/

const { tracks, statusText, isPaused, countdownSeconds, isLoading, error, lastUpdated, refreshFull } = usePointsPolling(
    () => filters,
    // 只有在首页时才激活轮询逻辑
    () => route.name === "home" && eventReady.value,
);

const togglePause = () => {
    isPaused.value = !isPaused.value;
};

const startLenis = () => {
    const wrapper = pageScrollRef.value;
    const content = pageContentRef.value;
    if (!wrapper || !content) return;
    lenis = new Lenis({
        wrapper,
        content,
        smoothWheel: true,
        syncTouch: false,
        allowNestedScroll: true,
    });
    const raf = (time: number) => {
        lenis?.raf(time);
        lenisFrame = requestAnimationFrame(raf);
    };
    lenisFrame = requestAnimationFrame(raf);
};

const stopLenis = () => {
    if (lenisFrame) {
        cancelAnimationFrame(lenisFrame);
        lenisFrame = 0;
    }
    lenis?.destroy();
    lenis = undefined;
};

onMounted(async () => {
    await nextTick();
    startLenis();
});

onBeforeUnmount(() => stopLenis());

// 监听路由路径变化以更新 Lenis
watch(
    () => route.path,
    async () => {
        await nextTick();
        if (lenis) lenis.resize();
    },
);
</script>

<template>
    <div class="h-full bg-appbg text-text">
        <div class="relative h-full">
            <SidebarMenu
                :items="menuItems"
                :active="activeMenu"
                :expanded="sidebarExpanded"
                @select="handleMenuSelect"
            />

            <button
                type="button"
                class="app-btn fixed top-3 z-50 border border-border/80 bg-surface/95 px-2 py-1.5 text-sm text-text shadow-sm transition-all duration-300 hover:bg-surface"
                :class="sidebarExpanded ? 'left-56' : 'left-3'"
                @click="sidebarExpanded = !sidebarExpanded"
            >
                <span class="relative block h-4 w-4">
                  <span class="absolute left-0 top-0.5 block h-0.5 w-4 bg-text"/>
                  <span class="absolute left-0 top-2 block h-0.5 w-4 bg-text"/>
                  <span class="absolute left-0 top-3.5 block h-0.5 w-4 bg-text"/>
                </span>
            </button>

            <div class="grid h-full min-h-0 min-w-0 grid-rows-[auto,1fr] transition-all duration-300"
                 :class="sidebarExpanded ? 'ml-52' : 'ml-0'">
                <TopStatusBar
                    :status="statusText"
                    :last-updated="lastUpdated"
                />

                <main ref="pageScrollRef" class="min-h-0 overflow-auto">
                    <div ref="pageContentRef">
                        <router-view v-slot="{ Component }">
                            <Transition name="page-swap" mode="out-in">
                                <div :key="route.path" class="content-flow py-3">
                                    <component
                                        :is="Component"
                                        v-bind="
                                            (route.name === 'home' || route.name === 'auto')
                                            ? {
                                                filters: filters,
                                                tracks: tracks,
                                                rowsPerPage: preferences.table.rowsPerPage,
                                                loading: isLoading,
                                                eventLoading: eventLoading,
                                                eventOptions: eventOptions,
                                                error: error,
                                                paused: isPaused,
                                                countdownSeconds: countdownSeconds
                                            }
                                            : (route.name === 'settings' ? { modelValue: preferences } : {})
                                        "
                                        @refresh="refreshFull"
                                        @toggle-pause="togglePause"
                                        @update:filters="Object.assign(filters, $event)"
                                        @update:modelValue="Object.assign(preferences, $event)"
                                    />
                                </div>
                            </Transition>
                        </router-view>
                    </div>
                </main>
            </div>
        </div>
    </div>
</template>