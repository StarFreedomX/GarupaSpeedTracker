<script setup lang="ts">
import Lenis from "lenis";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import TopStatusBar from "@/components/layout/TopStatusBar.vue";
import SidebarMenu from "@/components/navigation/SidebarMenu.vue";
import { useScorePolling } from "@/composables/useScorePolling";
import { useUserPreferences } from "@/composables/useUserPreferences";
import { buildEventOptions, selectBestEventId } from "@/features/event/eventSelection";
import { useI18n } from "@/i18n";
import { setApiBase } from "@/services/apiBase";
import { fetchEventList } from "@/services/eventApi";
import type { EventOption } from "@/types/event";
import AboutView from "@/views/AboutView.vue";
import HomeView from "@/views/HomeView.vue";
import SettingsView from "@/views/SettingsView.vue";

const { t } = useI18n();

const menuItems = computed(() => [
    { key: "home", label: t("menu.home") },
    { key: "settings", label: t("menu.settings") },
    { key: "about", label: t("menu.about") },
]);

const { preferences, applyTheme, persist } = useUserPreferences();
applyTheme(preferences.theme);
setApiBase(preferences.api);

const activeMenu = ref("home");
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

const readEventIdFromUrl = (): number | undefined => {
    const raw = new URLSearchParams(window.location.search).get("event");
    if (raw === null) {
        return undefined;
    }

    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const replaceEventInUrl = (eventId: number): void => {
    const url = new URL(window.location.href);
    url.searchParams.set("event", String(eventId));
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

const initialUrlEventId = readEventIdFromUrl();

const bootstrapEventOptions = async (preferUrlEvent: boolean): Promise<void> => {
    const token = eventBootstrapToken.value + 1;
    eventBootstrapToken.value = token;
    eventLoading.value = true;
    eventReady.value = false;

    try {
        const payload = await fetchEventList();
        if (token !== eventBootstrapToken.value) {
            return;
        }

        const now = Date.now();
        const options = buildEventOptions(payload, filters.server, now);
        eventOptions.value = options;

        const selectedEventId = selectBestEventId(options, now, preferUrlEvent ? initialUrlEventId : undefined) ?? filters.event;
        if (selectedEventId !== filters.event) {
            filters.event = selectedEventId;
        }

        replaceEventInUrl(selectedEventId);
    } catch {
        if (token === eventBootstrapToken.value) {
            eventOptions.value = [];
        }
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
        void bootstrapEventOptions(!hasResolvedInitialEvent.value && initialUrlEventId !== undefined);
    },
    { immediate: true },
);

watch(
    () => preferences.theme,
    (next) => {
        applyTheme(next);
    },
    { deep: true },
);

watch(
    () => preferences.api,
    (next) => {
        setApiBase(next);
    },
    { deep: true, immediate: true },
);

watch(preferences, () => persist(), { deep: true });

watch(
    () => filters.event,
    (next, previous) => {
        if (!eventReady.value || next === previous) {
            return;
        }

        replaceEventInUrl(next);
    },
);

const { tracks, statusText, isPaused, countdownSeconds, isLoading, error, lastUpdated, refreshFull } = useScorePolling(
    () => filters,
    () => activeMenu.value === "home" && eventReady.value,
);

const togglePause = () => {
    isPaused.value = !isPaused.value;
};

const startLenis = () => {
    const wrapper = pageScrollRef.value;
    const content = pageContentRef.value;

    if (!wrapper || !content) {
        return;
    }

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

onBeforeUnmount(() => {
    stopLenis();
});

watch(
    () => activeMenu.value,
    async () => {
        await nextTick();
        if (lenis) {
            lenis.resize();
        }
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
                @select="activeMenu = $event"
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
                        <Transition name="page-swap" mode="out-in">
                            <div :key="activeMenu" class="content-flow py-3">
                                <HomeView
                                    v-if="activeMenu === 'home'"
                                    :filters="filters"
                                    :tracks="tracks"
                                    :rows-per-page="preferences.table.rowsPerPage"
                                    :loading="isLoading"
                                    :event-loading="eventLoading"
                                    :event-options="eventOptions"
                                    :error="error"
                                    :paused="isPaused"
                                    :countdown-seconds="countdownSeconds"
                                    @refresh="refreshFull"
                                    @toggle-pause="togglePause"
                                    @update:filters="Object.assign(filters, $event)"
                                />
                                <SettingsView v-else-if="activeMenu === 'settings'" v-model="preferences"/>
                                <AboutView v-else/>
                            </div>
                        </Transition>
                    </div>
                </main>
            </div>
        </div>
    </div>
</template>





