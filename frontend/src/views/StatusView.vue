<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { fetchServiceStatus, type StatusSnapshot } from "@/services/statusApi";
import { formatDateTime } from "@/utils/time";

const { t } = useI18n();
const snapshot = ref<StatusSnapshot | null>(null);
const loading = ref(false);
const failed = ref(false);
const tasks = ["availability", "eventRankingTask", "monthlyRankingTask"];
const servers = ["JP", "EN", "TW", "CN", "KR"];
type Component = StatusSnapshot["components"][number];
function gameComponent(task: string, server: number) {
    return snapshot.value?.components.find(c => c.id === `${task}:${server}`);
}
function stateLabel(component?: Component) {
    if (failed.value || !component) return t("serviceStatus.unknown");
    if (component.status !== "unknown") return t(`serviceStatus.${component.status}`);
    return t(`serviceStatus.${component.checkedAt ? "stale" : "noRuns"}`);
}
function stateColor(component?: Component) {
    if (failed.value) return "text-muted";
    return component?.status === "operational" ? "text-green-700" : component?.status === "degraded" ? "text-amber-700" : "text-muted";
}
let controller: AbortController | undefined;
let disposed = false;

function serviceName(id: string) {
    const key = `serviceStatus.${id}`;
    return t(key) === key ? id : t(key);
}
async function refresh() {
    if (loading.value) return;
    loading.value = true;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
        const result = await fetchServiceStatus(request.signal);
        if (!disposed) { snapshot.value = result; failed.value = false; }
    } catch {
        if (!disposed) failed.value = true;
    } finally {
        clearTimeout(timeout);
        if (!disposed) loading.value = false;
    }
}
onMounted(() => {
    void refresh();
});
onBeforeUnmount(() => { disposed = true; controller?.abort(); });
</script>

<template>
    <section class="w-full max-w-3xl" :aria-busy="loading">
        <h1 class="mb-4 text-xl font-semibold">{{ t('serviceStatus.title') }}</h1>
        <div class="app-panel p-4 sm:p-5">
            <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <h2 class="text-base font-semibold">GarupaSpeedTracker</h2>
                <button type="button" class="app-btn border border-border px-3 py-1.5 text-xs disabled:opacity-50" :disabled="loading" @click="refresh">
                    {{ t(loading ? 'serviceStatus.refreshing' : 'serviceStatus.refresh') }}
                </button>
            </header>
            <p v-if="failed || !snapshot" class="py-5 text-sm text-muted" role="status">
                {{ t(failed ? 'serviceStatus.unavailable' : 'serviceStatus.loading') }}
            </p>
            <template v-if="snapshot">
                <section class="mt-5">
                    <h3 class="mb-3 text-sm font-semibold">{{ t('serviceStatus.game') }}</h3>
                    <div class="space-y-4">
                        <div v-for="task in tasks" :key="task">
                            <h4 class="mb-2 text-xs text-muted">{{ t(`serviceStatus.${task}`) }}</h4>
                            <dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
                                <div v-for="(server, index) in servers" :key="server">
                                    <dt class="text-xs font-medium">{{ server }}</dt>
                                    <dd class="mt-1 flex items-center gap-1.5 text-xs" :class="stateColor(gameComponent(task, index))" :title="gameComponent(task, index)?.checkedAt ? formatDateTime(gameComponent(task, index)!.checkedAt!) : t('serviceStatus.never')">
                                        <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                                        {{ stateLabel(gameComponent(task, index)) }}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </section>
                <section class="mt-5">
                    <h3 class="mb-3 text-sm font-semibold">{{ t('serviceStatus.core') }}</h3>
                    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                        <div v-for="component in snapshot.components.filter(c => c.group === 'core')" :key="component.id" class="min-w-0">
                            <dt class="text-xs text-muted">{{ serviceName(component.id) }}</dt>
                            <dd class="mt-1 flex items-center gap-1.5 text-sm" :class="stateColor(component)" :title="component.checkedAt ? formatDateTime(component.checkedAt) : t('serviceStatus.never')">
                                <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
                                {{ stateLabel(component) }}
                            </dd>
                        </div>
                    </dl>
                </section>
            </template>
            <footer v-if="snapshot" class="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted">
                <span v-if="snapshot">{{ t('serviceStatus.lastUpdated') }}：{{ formatDateTime(snapshot.checkedAt) }}</span>
            </footer>
        </div>
    </section>
</template>
