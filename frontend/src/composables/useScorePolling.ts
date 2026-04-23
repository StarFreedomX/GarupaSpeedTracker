import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getNextRefreshAt } from "@/composables/useRequestRefreshSchedule";
import { latestTimestamp, mergeTracks } from "@/features/score/scoreMath";
import { translate } from "@/i18n";
import { fetchScores } from "@/services/scoreApi";
import type { QueryPreferences } from "@/types/preferences";
import type { PlayerTrack, ScoreQuery } from "@/types/score";

const clampInteger = (value: number, min: number, max?: number): number => {
    const next = Math.round(value);
    const lower = Math.max(min, next);
    return max === undefined ? lower : Math.min(lower, max);
};

export const useScorePolling = (filters: () => QueryPreferences, enabled: () => boolean = () => true) => {
    const tracks = ref<PlayerTrack[]>([]);
    const isPaused = ref(false);
    const isLoading = ref(false);
    const lastUpdated = ref<number | null>(null);
    const error = ref<string>("");
    const hasBooted = ref(false);
    const countdownSeconds = ref(0);
    const nextRefreshAt = ref<number | null>(null);
    let boundaryTimer: number | undefined;
    let countdownTimer: number | undefined;

    const reset = () => {
        tracks.value = [];
        error.value = "";
    };

    const refresh = async (fullRefresh = false): Promise<void> => {
        if (!enabled()) {
            return;
        }

        isLoading.value = true;
        error.value = "";

        const settings = filters();

        const query: ScoreQuery = {
            server: settings.server,
            event: settings.event,
            time: settings.time,
            interval: clampInteger(settings.sampleIntervalSeconds, 1) * 1000,
            lastTimeStamp: fullRefresh || !hasBooted.value ? undefined : latestTimestamp(tracks.value),
        };

        try {
            const incoming = await fetchScores(query);
            tracks.value = fullRefresh ? incoming : mergeTracks(tracks.value, incoming);
            hasBooted.value = true;
            lastUpdated.value = Date.now();
        } catch (err) {
            error.value = err instanceof Error ? err.message : translate("error.unknown");
        } finally {
            isLoading.value = false;
        }
    };

    const refreshAndSchedule = async (fullRefresh = false): Promise<void> => {
        startCountdown();
        await refresh(fullRefresh);
        scheduleNextBoundaryRefresh();
    };

    const scheduleNextBoundaryRefresh = () => {
        window.clearTimeout(boundaryTimer);

        if (!enabled() || isPaused.value) {
            countdownSeconds.value = 0;
            return;
        }

        const next = getNextRefreshAt(filters(), tracks.value);
        nextRefreshAt.value = next;
        const delay = Math.max(0, next - Date.now());

        boundaryTimer = window.setTimeout(async () => {
            if (!isPaused.value) {
                await refreshAndSchedule();
                return;
            }

            scheduleNextBoundaryRefresh();
        }, delay);
    };

    const startCountdown = () => {
        window.clearInterval(countdownTimer);
        countdownTimer = window.setInterval(() => {
            if (isPaused.value || !nextRefreshAt.value) {
                countdownSeconds.value = 0;
                return;
            }

            countdownSeconds.value = Math.max(0, Math.ceil((nextRefreshAt.value - Date.now()) / 1000));
        }, 1000);
    };

    watch(
        enabled,
        (next) => {
            window.clearTimeout(boundaryTimer);

            if (!next) {
                window.clearInterval(countdownTimer);
                countdownSeconds.value = 0;
                nextRefreshAt.value = null;
                hasBooted.value = false;
                return;
            }

            if (!hasBooted.value) {
                reset();
                hasBooted.value = false;
                void refreshAndSchedule(true);
                return;
            }

            scheduleNextBoundaryRefresh();
        },
        { immediate: true },
    );

    watch(
        filters,
        () => {
            if (!enabled()) {
                return;
            }

            reset();
            hasBooted.value = false;
            void refreshAndSchedule();
        },
        { deep: true },
    );

    watch(isPaused, () => {
        if (!enabled()) {
            return;
        }

        scheduleNextBoundaryRefresh();
    });

    onBeforeUnmount(() => {
        window.clearTimeout(boundaryTimer);
        window.clearInterval(countdownTimer);
    });

    const statusText = computed(() => {
        if (isLoading.value) {
            return translate("status.fetching");
        }
        if (error.value) {
            return translate("status.error");
        }
        return translate("status.online");
    });

    return {
        tracks,
        isPaused,
        countdownSeconds,
        isLoading,
        lastUpdated,
        error,
        statusText,
        refresh,
        refreshFull: () => refresh(true),
    };
};
