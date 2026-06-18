<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useUserPreferences } from "@/composables/useUserPreferences";
import { buildEventOptions } from "@/features/event/eventSelection";
import type { ActivityType } from "@/features/scoreControl/types";
import { useI18n } from "@/i18n";
import { fetchEventList } from "@/services/eventApi";
import { type CardSkillInfo, fetchPlayerDeckStatus, type PlayerDeckStatusResult } from "@/services/playerDeckApi";
import type { EventOption } from "@/types/event";
import type { ServerKey } from "@/types/points";
import type { Skill, SkillDuration } from "@/types/songMetadata";

const { t } = useI18n();
const { preferences } = useUserPreferences();

const SERVER_OPTIONS = [
    { key: 0 as ServerKey, label: "JP" },
    { key: 1 as ServerKey, label: "EN" },
    { key: 2 as ServerKey, label: "TW" },
    { key: 3 as ServerKey, label: "CN" },
    { key: 4 as ServerKey, label: "KR" },
];

// ─── 表单状态 ───

const DECK_STORAGE_KEY = "playerDeckFetcher_form";

function loadSavedForm(): { server?: ServerKey; eventId?: number; playerId?: string } {
    try {
        const raw = localStorage.getItem(DECK_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveForm() {
    localStorage.setItem(
        DECK_STORAGE_KEY,
        JSON.stringify({
            server: server.value,
            eventId: eventId.value,
            playerId: playerId.value,
        }),
    );
}

const saved = loadSavedForm();
const server = ref<ServerKey>(saved.server ?? preferences.query.server);
const eventId = ref<number | undefined>(saved.eventId ?? preferences.query.event);
const playerId = ref(saved.playerId ?? "");
const loading = ref(false);
const result = ref<PlayerDeckStatusResult | null>(null);
const errorMsg = ref<string | null>(null);
const eventOptions = ref<EventOption[]>([]);
const eventsLoading = ref(false);

watch([server, eventId, playerId], saveForm, { deep: false });

// ─── emit ───

const emit =
    defineEmits<
        (
            e: "deckFetched",
            data: {
                totalPower: number;
                eventBonus: number;
                activityType: ActivityType;
                skills: Skill[];
                server: ServerKey;
                eventId: number;
                eventName: string;
                warnings: string[];
            },
        ) => void
    >();

// ─── 映射函数 ───

function mapEventType(eventType: string): ActivityType {
    const map: Record<string, ActivityType> = {
        mission: "mission",
        try: "try",
        challenge: "challenge",
        versus: "versus",
        "5v5": "5v5",
        medley: "medley1",
        festival: "medley1",
    };
    return map[eventType] ?? "mission";
}

/** 将后端技能数据转为前端 Skill 类型（后端百分比 → 前端小数） */
function mapSkill(cs: CardSkillInfo): Skill {
    const dur = Number(cs.durationSeconds).toFixed(1);
    return {
        scoreUp: cs.bonusPercent / 100,
        duration: dur as SkillDuration,
        progressive: cs.progressive ? { stepRate: cs.progressive.stepRate / 100, maxCap: cs.progressive.maxCap / 100 } : undefined,
    };
}

// ─── 提示信息 ───

const warnings = computed<string[]>(() => {
    if (!result.value) return [];
    const w: string[] = [];
    if (!result.value.publishTotalDeckPowerFlg) {
        w.push(t("playerDeck.warnPowerNotPublic"));
    }
    if (result.value.eventType === "mission") {
        w.push(t("playerDeck.warnMissionSupport"));
    }
    if (result.value.eventType === "medley" || result.value.eventType === "festival") {
        w.push(t("playerDeck.warnMedleyCheck"));
    }
    return w;
});

const successMsg = computed(() => {
    if (!result.value) return null;
    return t("playerDeck.success", { eventName: result.value.eventName });
});

// ─── 加载活动列表 ───

async function loadEvents() {
    eventsLoading.value = true;
    try {
        const raw = await fetchEventList();
        eventOptions.value = buildEventOptions(raw, server.value);
    } catch {
        eventOptions.value = [];
    } finally {
        eventsLoading.value = false;
    }
}

// ─── 获取玩家编队 ───

async function fetchDeck() {
    const pid = Number(playerId.value);
    if (!Number.isFinite(pid) || pid < 1) {
        errorMsg.value = t("playerDeck.error", { message: "请输入有效的玩家ID" });
        return;
    }

    loading.value = true;
    errorMsg.value = null;
    result.value = null;

    try {
        const data = await fetchPlayerDeckStatus({
            server: server.value,
            playerId: pid,
            eventId: eventId.value,
        });
        result.value = data;

        emit("deckFetched", {
            totalPower: data.autoPower,
            eventBonus: data.eventBonusPct,
            activityType: mapEventType(data.eventType),
            skills: data.skills.map(mapSkill),
            server: server.value,
            eventId: data.eventId ?? eventId.value ?? 0,
            eventName: data.eventName,
            warnings: warnings.value,
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errorMsg.value = t("playerDeck.error", { message: msg });
    } finally {
        loading.value = false;
    }
}

// ─── 初始化 ───

onMounted(loadEvents);
watch(server, loadEvents);
</script>

<template>
    <div class="rounded border border-border/80 bg-surface/50 p-3">
        <div class="mb-2 text-sm font-medium">{{ t("playerDeck.title") }}</div>

        <div class="flex flex-wrap items-end gap-2">
            <!-- 服务器 -->
            <label class="flex flex-col gap-1 text-xs text-muted">
                {{ t("playerDeck.server") }}
                <select
                    v-model.number="server"
                    class="rounded border border-border/80 bg-surface/90 px-4 py-1.5 text-sm text-text"
                >
                    <option v-for="opt in SERVER_OPTIONS" :key="opt.key" :value="opt.key">
                        {{ opt.label }}
                    </option>
                </select>
            </label>

            <!-- 活动 -->
            <label class="flex flex-col gap-1 text-xs text-muted">
                {{ t("playerDeck.event") }}
                <select
                    v-model.number="eventId"
                    class="rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text min-w-40"
                    :disabled="eventsLoading"
                >
                    <option :value="undefined" disabled>{{ eventsLoading ? "..." : "" }}</option>
                    <option
                        v-for="opt in eventOptions"
                        :key="opt.eventId"
                        :value="opt.eventId"
                    >
                        {{ opt.label }}
                    </option>
                </select>
            </label>

            <!-- 玩家ID -->
            <label class="flex flex-col gap-1 text-xs text-muted">
                {{ t("playerDeck.playerId") }}
                <input
                    v-model="playerId"
                    type="text"
                    inputmode="numeric"
                    class="w-28 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                    @keyup.enter="fetchDeck"
                />
            </label>

            <!-- 按钮 -->
            <button
                type="button"
                class="app-btn border border-primary/40 bg-primary/15 px-4 py-1.5 text-sm text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="loading"
                @click="fetchDeck"
            >
                {{ loading ? "..." : t("playerDeck.fetch") }}
            </button>
        </div>

        <!-- 状态信息 -->
        <div v-if="successMsg || errorMsg || warnings.length" class="mt-2 space-y-1 text-xs">
            <p v-if="successMsg" class="text-green">{{ successMsg }}</p>
            <p v-if="errorMsg" class="text-red">{{ errorMsg }}</p>
            <p v-for="(w, i) in warnings" :key="i" class="text-primary">{{ w }}</p>
        </div>
    </div>
</template>
