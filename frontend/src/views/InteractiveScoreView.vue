<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import SkillDurationPicker from "@/components/common/SkillDurationPicker.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import { analyze, computeFixedBasePTs, findContiguousWindows } from "@/features/scoreControl/interactiveAnalysis";
import type { ActivityType, AnalysisResult, PlayStep, SolutionFilter, TeamConfig } from "@/features/scoreControl/types";
import { useI18n } from "@/i18n";
import { fetchMetadata } from "@/services/songMetadataApi";
import { fetchSongList } from "@/services/songsApi";
import type { Skill, SongChartMeta } from "@/types/songMetadata";
import type { MusicDataResponse } from "@/types/songs";

const { t } = useI18n();

// ─── localStorage keys ───
const STORAGE_KEYS = {
    FORM_DATA: "interactive_formData",
    SKILLS: "interactive_skills",
    CENTER_INDEX: "interactive_centerIndex",
} as const;

// ─── activity type options ───
const ACTIVITY_TYPES = [
    { value: "mission", label: t("eventType.mission"), icon: "📋" },
    { value: "try", label: t("eventType.try"), icon: "✅" },
    { value: "challenge", label: t("eventType.challenge"), icon: "🟣" },
    { value: "versus", label: t("eventType.versus"), icon: "⚔️" },
    { value: "5v5", label: t("eventType.5v5"), icon: "🏟️" },
    { value: "medley1", label: t("eventType.medley1"), icon: "🎵" },
] as const;

// ─── auto presets ───
const AUTO_PRESETS = [
    { id: "cn", label: t("auto.server.cn"), value: 0.5 },
    { id: "jp", label: t("auto.server.jp"), value: 0.75 },
    { id: "others", label: t("auto.server.others"), value: null },
] as const;

// ─── defaults ───
const defaultFormData = {
    activityType: "mission" as ActivityType,
    targetPT: 300,
    totalPower: 300000,
    supportBandPower: 0,
    eventBonus: 0,
    autoPara: 0.75,
};

const defaultSkills: Skill[] = [
    { duration: "7.0", scoreUp: 1.5 },
    { duration: "7.0", scoreUp: 1.5 },
    { duration: "7.0", scoreUp: 1.55 },
    { duration: "7.0", scoreUp: 1.3 },
    { duration: "7.0", scoreUp: 1.3 },
];

const defaultCenterIndex = 2;

const defaultFilter: SolutionFilter = {
    allowFull: true,
    bandEnabled: false,
    bandId: null,
    bandMode: "contains",
    boostEnabled: false,
    boostString: null,
};

// ─── reactive state ───
const currentStep = ref(1);
const formData = ref({ ...defaultFormData });
const filterData = ref<SolutionFilter>({ ...defaultFilter });
const skills = ref<Skill[]>([...defaultSkills]);
const centerIndex = ref(defaultCenterIndex);
const autoPreset = ref<"jp" | "cn" | "others">("jp");
const showAdvancedFilter = ref(false);

// metadata
const metadataLoading = ref(false);
const metadataError = ref("");
const songMetadata = ref<SongChartMeta>({});
const songList = ref<MusicDataResponse>({});

// analysis
const computing = ref(false);
const analysisResult = ref<AnalysisResult | null>(null);

// ─── computed ───
const centerSkill = computed(() => skills.value[centerIndex.value]);
const showSupportBand = computed(() => formData.value.activityType === "mission");
const showEventBonus = computed(() => ["mission", "try", "challenge"].includes(formData.value.activityType));

const teamConfig = computed<TeamConfig>(() => ({
    totalPower: formData.value.totalPower,
    supportBandPower: formData.value.supportBandPower,
    eventBonus: formData.value.eventBonus,
    autoPara: formData.value.autoPara,
    skills: skills.value,
    centerIndex: centerIndex.value,
}));

// 目标 PT 步骤的区间预览
const previewWindows = computed(() => {
    if (Object.keys(songMetadata.value).length === 0) return null;
    if (Object.keys(songList.value).length === 0) return null;
    try {
        const { achievableBasePTs } = computeFixedBasePTs(teamConfig.value, formData.value.activityType, songMetadata.value, songList.value, filterData.value);
        if (achievableBasePTs.length === 0) return null;
        return findContiguousWindows(achievableBasePTs);
    } catch {
        return null;
    }
});

const isStepValid = computed(() => {
    switch (currentStep.value) {
        case 1:
            return ACTIVITY_TYPES.some((t) => t.value === formData.value.activityType);
        case 2:
            return formData.value.totalPower > 0 && skills.value.length === 5;
        case 3:
            return formData.value.targetPT > 0 && formData.value.targetPT <= 10000000;
        default:
            return true;
    }
});

// ─── step navigation ───
const nextStep = () => {
    if (currentStep.value < 4 && isStepValid.value) {
        currentStep.value++;
        if (currentStep.value === 4) {
            runAnalysis();
        }
    }
};

const prevStep = () => {
    if (currentStep.value > 1) {
        currentStep.value--;
        // 回到配置步骤时清除旧结果
        if (currentStep.value < 4) {
            analysisResult.value = null;
        }
    }
};

const goToStep = (step: number) => {
    currentStep.value = step;
    if (step === 4) {
        runAnalysis();
    } else {
        analysisResult.value = null;
    }
};

// ─── auto preset logic ───
const handleAutoPresetChange = () => {
    const preset = AUTO_PRESETS.find((p) => p.id === autoPreset.value);
    if (preset?.value !== null && preset?.value !== undefined) {
        formData.value.autoPara = preset.value;
    }
};

watch(
    () => formData.value.autoPara,
    () => {
        if (formData.value.autoPara === AUTO_PRESETS.find((p) => p.id === "cn")?.value) {
            autoPreset.value = "cn";
        } else if (formData.value.autoPara === AUTO_PRESETS.find((p) => p.id === "jp")?.value) {
            autoPreset.value = "jp";
        } else {
            autoPreset.value = "others";
        }
    },
);

// ─── skill helpers ───
const updateSkill = (index: number, field: keyof Skill, value: string | number) => {
    skills.value[index] = { ...skills.value[index], [field]: value };
};

const resetSkills = () => {
    skills.value = JSON.parse(JSON.stringify(defaultSkills));
    centerIndex.value = defaultCenterIndex;
};

// ─── metadata loading ───
const loadMetadata = async () => {
    metadataLoading.value = true;
    try {
        const [meta, songs] = await Promise.all([fetchMetadata(), fetchSongList()]);
        songMetadata.value = meta;
        songList.value = songs;
    } catch {
        metadataError.value = t("interactive.error.noMetadata");
    } finally {
        metadataLoading.value = false;
    }
};

// ─── analysis ───
const runAnalysis = () => {
    if (!isStepValid.value) return;
    if (Object.keys(songMetadata.value).length === 0) {
        metadataError.value = t("interactive.error.noMetadata");
        return;
    }

    computing.value = true;
    metadataError.value = "";

    // 使用 setTimeout 让 UI 有机会渲染 loading 状态
    setTimeout(() => {
        try {
            analysisResult.value = analyze(
                formData.value.targetPT,
                formData.value.activityType,
                teamConfig.value,
                songMetadata.value,
                songList.value,
                filterData.value,
            );
        } catch (err) {
            console.error("Analysis failed:", err);
            metadataError.value = String(err);
        } finally {
            computing.value = false;
        }
    }, 50);
    // reset alternative index on new analysis
    alternativeIndex.value = -1;
};

// ─── alternative solutions cycling ───
const alternativeIndex = ref(-1);

const currentStrategy = computed<PlayStep[] | null>(() => {
    if (!analysisResult.value?.feasible) return null;
    if (alternativeIndex.value < 0) return analysisResult.value.strategy;
    const alts = analysisResult.value.alternatives;
    if (alts && alternativeIndex.value < alts.length) {
        return alts[alternativeIndex.value];
    }
    return analysisResult.value.strategy;
});

const totalSolutions = computed(() => {
    if (!analysisResult.value?.feasible) return 0;
    return 1 + (analysisResult.value.alternatives?.length ?? 0);
});

const goNextAlternative = () => {
    if (!analysisResult.value?.feasible) return;
    const total = totalSolutions.value;
    if (total <= 1) return;
    alternativeIndex.value = ((alternativeIndex.value + 2) % total) - 1;
};

const goPrevAlternative = () => {
    if (!analysisResult.value?.feasible) return;
    const total = totalSolutions.value;
    if (total <= 1) return;
    if (alternativeIndex.value < 0) alternativeIndex.value = total - 2;
    else if (alternativeIndex.value === 0) alternativeIndex.value = -1;
    else alternativeIndex.value--;
};

const goToMain = () => {
    alternativeIndex.value = -1;
};

// 键盘导航：左右方向键切换方案
const handleKeydown = (e: KeyboardEvent) => {
    if (currentStep.value !== 4) return;
    if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextAlternative();
    } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevAlternative();
    }
};

// 歌曲选中状态 & 分数范围
const selectedSongKey = ref<string | null>(null); // `${stepIdx}-${songId}-${diffKey}`
const toggleSong = (stepIdx: number, song: { songId: number; difficultyKey: string }) => {
    const key = `${stepIdx}-${song.songId}-${song.difficultyKey}`;
    selectedSongKey.value = selectedSongKey.value === key ? null : key;
};

// 选中歌曲的实际 auto 分数范围（来自自动控分表的 calcScore）
const selectedScoreRange = computed(() => {
    if (!selectedSongKey.value || !currentStrategy.value) return null;
    const [stepIdxStr, songIdStr, diffKey] = selectedSongKey.value.split("-");
    const stepIdx = Number(stepIdxStr);
    const step = currentStrategy.value[stepIdx];
    if (!step) return null;
    const song = step.songs.find((s) => s.songId === Number(songIdStr) && s.difficultyKey === diffKey);
    if (!song) return null;
    return { min: song.minScore, max: song.maxScore };
});

// ─── persistence ───
const saveFormData = () => {
    localStorage.setItem(STORAGE_KEYS.FORM_DATA, JSON.stringify(formData.value));
};
const saveSkills = () => {
    localStorage.setItem(STORAGE_KEYS.SKILLS, JSON.stringify(skills.value));
};
const saveCenterIndex = () => {
    localStorage.setItem(STORAGE_KEYS.CENTER_INDEX, String(centerIndex.value));
};
const saveFilter = () => {
    localStorage.setItem("interactive_filter", JSON.stringify(filterData.value));
};

const loadFromStorage = () => {
    try {
        const savedForm = localStorage.getItem(STORAGE_KEYS.FORM_DATA);
        if (savedForm) {
            formData.value = { ...defaultFormData, ...JSON.parse(savedForm) };
        }
        const savedSkills = localStorage.getItem(STORAGE_KEYS.SKILLS);
        if (savedSkills) {
            const parsed = JSON.parse(savedSkills);
            if (Array.isArray(parsed) && parsed.length === 5) {
                skills.value = parsed;
            }
        }
        const savedCenter = localStorage.getItem(STORAGE_KEYS.CENTER_INDEX);
        if (savedCenter !== null) {
            centerIndex.value = Number.parseInt(savedCenter, 10);
        }
        const savedFilter = localStorage.getItem("interactive_filter");
        if (savedFilter) {
            filterData.value = { ...defaultFilter, ...JSON.parse(savedFilter) };
        }
    } catch (err) {
        console.error("Failed to load interactive form data:", err);
    }
};

watch(formData, saveFormData, { deep: true });
watch(skills, saveSkills, { deep: true });
watch(centerIndex, saveCenterIndex);
watch(filterData, saveFilter, { deep: true });

onMounted(() => {
    loadFromStorage();
    loadMetadata();
    if (formData.value.autoPara === 0.5) autoPreset.value = "cn";
    else if (formData.value.autoPara === 0.75) autoPreset.value = "jp";
    else autoPreset.value = "others";
    window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
    window.removeEventListener("keydown", handleKeydown);
});

// ─── flame labels ───
const flameMultiplierLabel = (m: number) => `×${m}`;

// ─── no fixed songs detection ───
const hasNoFixedSongs = computed(() => {
    const bl = analysisResult.value?.boostLevels;
    if (!bl || bl.length === 0) return false;
    return bl[0].achievableBasePTs.length === 0;
});
</script>

<template>
    <div class="grid gap-3">
        <!-- ─── Step indicator ─── -->
        <div class="rounded border border-border/80 bg-surface/50 p-3">
            <div class="flex items-center gap-4">
                <span class="text-sm font-medium text-text">
                    {{ t('interactive.step', { current: currentStep, total: 4 }) }}
                </span>
                <div class="flex gap-1.5">
                    <button
                        v-for="s in 4"
                        :key="s"
                        type="button"
                        class="h-2 rounded-full transition-all duration-300"
                        :class="s <= currentStep
                            ? 'w-10 bg-primary'
                            : 'w-6 bg-border/60 hover:bg-border/80'"
                        :title="`Step ${s}`"
                        @click="s < currentStep || (s === currentStep) ? goToStep(s) : undefined"
                    />
                </div>
                <span class="ml-auto text-xs text-muted">
                    {{ currentStep === 1 ? t('interactive.step1.title')
                        : currentStep === 2 ? t('interactive.step2.title')
                        : currentStep === 3 ? t('interactive.step3.title')
                        : t('interactive.step4.title') }}
                </span>
            </div>
        </div>

        <!-- ═══════ Step 1: Select activity type ═══════ -->
        <div
            v-if="currentStep === 1"
            class="rounded border border-border/80 bg-surface/50 p-3"
        >
            <div class="mb-3 text-sm font-medium">{{ t('interactive.step1.title') }}</div>
            <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                <button
                    v-for="type in ACTIVITY_TYPES"
                    :key="type.value"
                    type="button"
                    class="cursor-pointer rounded border p-4 text-center transition-all duration-200"
                    :class="formData.activityType === type.value
                        ? 'border-primary/40 bg-primary/10 shadow-sm shadow-primary/10'
                        : 'border-border/80 hover:border-border hover:bg-surface/70'"
                    @click="formData.activityType = type.value"
                >
                    <div class="text-2xl mb-1">{{ type.icon }}</div>
                    <div
                        class="text-sm font-medium"
                        :class="formData.activityType === type.value ? 'text-primary' : 'text-text'"
                    >
                        {{ type.label }}
                    </div>
                </button>
            </div>
        </div>

        <!-- ═══════ Step 3: Target PT ═══════ -->
        <div
            v-if="currentStep === 3"
            class="rounded border border-border/80 bg-surface/50 p-3"
        >
            <div class="mb-3 text-sm font-medium">{{ t('interactive.step3.title') }}</div>
            <div class="mx-auto max-w-md">
                <div class="flex items-center gap-3">
                    <span class="w-20 text-sm text-muted">{{ t('interactive.step3.targetPt') }}</span>
                    <input
                        v-model.number="formData.targetPT"
                        type="number"
                        min="1"
                        max="10000000"
                        class="flex-1 rounded border border-border/80 bg-surface/90 px-3 py-2 text-lg text-text font-mono text-center"
                        :placeholder="t('interactive.step3.placeholder')"
                        @keyup.enter="nextStep"
                    />
                </div>
                <p
                    v-if="formData.targetPT <= 0 || formData.targetPT > 10000000"
                    class="mt-2 text-xs text-red-400"
                >
                    {{ t('interactive.error.invalidPt') }}
                </p>

                <!-- Advanced filter toggle -->
                <div class="mt-3 pt-3 border-t border-border/60">
                    <button
                        type="button"
                        class="flex items-center gap-1 text-xs text-muted hover:text-text transition-colors"
                        @click="showAdvancedFilter = !showAdvancedFilter"
                    >
                        <span>{{ showAdvancedFilter ? '▾' : '▸' }}</span>
                        <span>{{ t('interactive.filter.title') }}</span>
                    </button>

                    <div v-if="showAdvancedFilter" class="mt-2 space-y-2">
                        <!-- FULL filter -->
                        <label class="flex items-center gap-2 text-xs text-muted cursor-pointer">
                            <input
                                v-model="filterData.allowFull"
                                type="checkbox"
                                class="h-3.5 w-3.5 rounded border-border/80"
                            />
                            <span>{{ t('interactive.filter.allowFull') }}</span>
                        </label>

                        <!-- Band filter -->
                        <div class="flex items-center gap-2">
                            <input
                                v-model="filterData.bandEnabled"
                                type="checkbox"
                                class="h-3.5 w-3.5 rounded border-border/80"
                            />
                            <span class="text-xs text-muted w-24">{{ t('interactive.filter.bandFilter') }}</span>
                            <input
                                v-model.number="filterData.bandId"
                                :disabled="!filterData.bandEnabled"
                                type="number"
                                class="w-20 rounded border border-border/80 bg-surface/90 px-1.5 py-1 text-xs text-text disabled:opacity-40"
                                placeholder="ID"
                            />
                            <select
                                v-model="filterData.bandMode"
                                :disabled="!filterData.bandEnabled"
                                class="rounded border border-border/80 bg-surface/90 px-1.5 py-1 text-xs text-text disabled:opacity-40"
                            >
                                <option value="contains">{{ t('interactive.filter.bandModeContains') }}</option>
                                <option value="all">{{ t('interactive.filter.bandModeAll') }}</option>
                            </select>
                        </div>

                        <!-- Boost string -->
                        <div class="flex items-center gap-2">
                            <input
                                v-model="filterData.boostEnabled"
                                type="checkbox"
                                class="h-3.5 w-3.5 rounded border-border/80"
                            />
                            <span class="text-xs text-muted w-24">{{ t('interactive.filter.boostString') }}</span>
                            <input
                                v-model="filterData.boostString"
                                :disabled="!filterData.boostEnabled"
                                type="text"
                                class="flex-1 rounded border border-border/80 bg-surface/90 px-1.5 py-1 text-xs text-text font-mono disabled:opacity-40"
                                :placeholder="t('interactive.filter.boostPlaceholder')"
                            />
                        </div>

                        <!-- Reset filter -->
                        <button
                            type="button"
                            class="text-xs text-muted hover:text-text transition-colors"
                            @click="filterData = { ...defaultFilter }"
                        >
                            {{ t('interactive.filter.reset') }}
                        </button>
                    </div>
                </div>

                <!-- Contiguous windows preview -->
                <div v-if="previewWindows && previewWindows.length > 0" class="mt-3 pt-3 border-t border-border/60">
                    <p class="mb-2 text-xs font-medium text-text">{{ t('interactive.step4.windowPreview') }}</p>
                    <div class="space-y-2">
                        <div v-for="w in previewWindows" :key="w.plays">
                            <p class="text-xs text-muted mb-0.5">{{ t('interactive.step4.playsLabel', { plays: w.plays }) }}</p>
                            <p
                                v-for="(seg, si) in w.segments"
                                :key="si"
                                class="text-xs text-muted ml-3"
                                :class="si === 0 ? '' : 'opacity-60'"
                            >
                                <span v-if="si === 0">★ </span><span v-else>  </span>
                                <span class="font-mono text-text">[{{ seg.lo.toLocaleString() }}, {{ seg.hi.toLocaleString() }}]</span>
                                （{{ t('interactive.step4.segmentLen', { center: seg.center.toLocaleString(), len: (seg.hi - seg.lo + 1).toLocaleString() }) }}）
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ═══════ Step 2: Team config ═══════ -->
        <div v-if="currentStep === 2" class="grid gap-4 md:grid-cols-2">
            <!-- Left: Event params -->
            <div class="rounded border border-border/80 bg-surface/50 p-3">
                <div class="mb-2 text-sm font-medium">{{ t('auto.config.eventParams') }}</div>
                <div class="space-y-3">
                    <div class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.eventType') }}</span>
                        <span class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text">
                            {{ ACTIVITY_TYPES.find(t => t.value === formData.activityType)?.label }}
                        </span>
                    </div>

                    <div class="flex items-center gap-3">
                        <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.totalPower') }}</span>
                        <input
                            v-model.number="formData.totalPower"
                            type="number"
                            min="0"
                            class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>
                    <p class="mt-1 ml-[5.5rem] text-[10px] leading-none text-muted/60">{{ t('auto.config.totalPowerNote') }}</p>

                    <div v-if="showSupportBand" class="flex items-center gap-3">
                        <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.supportPower') }}</span>
                        <input
                            v-model.number="formData.supportBandPower"
                            type="number"
                            min="0"
                            class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>

                    <div v-if="showEventBonus" class="flex items-center gap-3">
                        <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.eventBonus') }}</span>
                        <input
                            v-model.number="formData.eventBonus"
                            type="number"
                            min="0"
                            class="no-spin flex-1 min-w-0 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <span class="w-20 shrink-0 text-sm text-muted">{{ t('auto.config.autoRate') }}</span>
                        <div class="flex min-w-0 gap-2">
                            <select
                                v-model="autoPreset"
                                class="w-24 sm:w-28 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                                @change="handleAutoPresetChange"
                            >
                                <option value="cn">{{ t('auto.server.cn') }}</option>
                                <option value="jp">{{ t('auto.server.jp') }}</option>
                                <option value="others">{{ t('auto.server.others') }}</option>
                            </select>
                            <input
                                v-if="autoPreset === 'others'"
                                v-model.number="formData.autoPara"
                                type="number"
                                min="0"
                                step="0.01"
                                class="no-spin w-24 sm:w-28 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                                :placeholder="t('auto.config.ratePlaceholder')"
                            />
                            <span
                                v-else
                                class="w-24 sm:w-28 truncate rounded border border-border/80 bg-surface/90 px-1.5 sm:px-2 py-1.5 text-sm text-text"
                            >
                                {{ t('auto.config.rateLabel') }} {{ formData.autoPara }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right: Skill config -->
            <div class="rounded border border-border/80 bg-surface/50 p-3">
                <div class="mb-2 flex items-center justify-between">
                    <span class="text-sm font-medium">{{ t('auto.config.skillConfig') }}</span>
                    <button
                        type="button"
                        class="text-xs text-muted hover:text-text"
                        @click="resetSkills"
                    >
                        {{ t('common.resetDefault') }}
                    </button>
                </div>

                <div class="space-y-2">
                    <div class="text-xs font-medium text-muted">{{ t('auto.config.skillOrderHint') }}</div>
                    <div class="grid gap-2">
                        <div v-for="(skill, idx) in skills" :key="idx" class="flex items-center gap-1.5 min-w-0">
                            <div class="flex items-center gap-1 shrink-0">
                                <input
                                    type="radio"
                                    :checked="centerIndex === idx"
                                    class="h-3.5 w-3.5"
                                    @change="centerIndex = idx"
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
                                    @update:model-value="updateSkill(idx, 'duration', $event)"
                                />
                                <span class="hidden sm:inline text-xs text-muted">{{ t('common.unitSecond') }}</span>
                            </div>
                            <input
                                :value="skill.scoreUp"
                                type="number"
                                min="0"
                                step="0.01"
                                class="no-spin w-20 min-w-0 rounded border border-border/80 bg-surface/90 px-1.5 py-1.5 text-sm text-left"
                                @input="updateSkill(idx, 'scoreUp', parseFloat(($event.target as HTMLInputElement).value))"
                            />
                            <span class="shrink-0 text-xs text-muted">{{ t('auto.config.skillRateLabel') }}</span>
                        </div>
                    </div>
                </div>

                <div class="mt-2 text-xs text-muted">
                    <span class="text-primary">● {{ t('auto.config.skillCenterHint') }}</span>
                </div>
            </div>
        </div>

        <!-- ═══════ Step 4: Results ═══════ -->
        <div v-if="currentStep === 4">
            <!-- Loading -->
            <div
                v-if="computing"
                class="rounded border border-border/80 bg-surface/50 p-8 text-center text-muted text-sm"
            >
                {{ t('interactive.step4.computing') }}
            </div>

            <!-- Metadata error -->
            <div
                v-else-if="metadataError"
                class="rounded border border-border/80 bg-surface px-3 py-2 text-sm text-muted"
            >
                {{ metadataError }}
            </div>

            <!-- Results -->
            <template v-else-if="analysisResult">
                <!-- Feasible solution -->
                <template v-if="analysisResult.feasible">
                    <!-- Solution summary with alternative toggle -->
                    <div class="rounded border border-primary/40 bg-primary/8 p-3 mb-3">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <span class="text-lg">✅</span>
                                <span class="text-sm font-medium text-text">
                                    {{
                                        currentStrategy
                                            ? t('interactive.step4.solution', { plays: currentStrategy.length })
                                            : ''
                                    }}
                                </span>
                            </div>
                            <div
                                v-if="totalSolutions > 1"
                                class="flex items-center gap-1"
                            >
                                <button
                                    v-if="alternativeIndex >= 0"
                                    type="button"
                                    class="app-btn border border-border/60 bg-surface/80 px-2 py-0.5 text-xs text-muted hover:text-text transition-colors"
                                    :title="t('interactive.step4.mainPlan')"
                                    @click="goToMain"
                                >
                                    ↻
                                </button>
                                <button
                                    type="button"
                                    class="app-btn border border-border/60 bg-surface/80 px-2 py-0.5 text-xs text-muted hover:text-text transition-colors"
                                    @click="goPrevAlternative"
                                >
                                    ◀
                                </button>
                                <span class="text-xs text-muted px-1 font-mono">
                                    {{ alternativeIndex < 0 ? t('interactive.step4.mainPlan') : t('interactive.step4.altPlan', { index: alternativeIndex + 1 }) }}
                                    / {{ totalSolutions }}
                                </span>
                                <button
                                    type="button"
                                    class="app-btn border border-border/60 bg-surface/80 px-2 py-0.5 text-xs text-muted hover:text-text transition-colors"
                                    @click="goNextAlternative"
                                >
                                    ▶
                                </button>
                            </div>
                        </div>
                        <div
                            v-if="currentStrategy"
                            class="mt-2 ml-7 text-sm font-mono text-primary"
                        >
                            {{ t('interactive.step4.totalPT') }} = {{ currentStrategy.reduce((s, st) => s + st.boostedPT, 0).toLocaleString() }}
                        </div>
                    </div>

                    <!-- Per-play detail (using currentStrategy) -->
                    <div
                        v-for="(step, i) in (currentStrategy ?? [])"
                        :key="i"
                        class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                    >
                        <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span class="text-sm font-medium text-text">
                                {{ t('interactive.step4.playsCount', { count: i + 1 }) }} —
                                {{ t('interactive.step4.flameCount', { flames: step.flames }) }}
                            </span>
                            <span class="text-xs text-muted">
                                {{ t('interactive.step4.basePT') }} = <span class="font-mono text-text">{{ step.basePT.toLocaleString() }}</span>
                                × {{ step.multiplier }}
                                = <span class="font-mono font-bold text-primary">{{ step.boostedPT.toLocaleString() }} PT</span>
                            </span>
                            <span
                                v-if="step.songs.length > 0"
                                class="text-xs text-muted"
                            >
                                — {{ t('interactive.step4.songsAvailable', { count: step.songs.length }) }}
                            </span>
                            <span
                                v-if="selectedScoreRange && selectedSongKey?.startsWith(String(i))"
                                class="text-xs font-mono text-primary"
                            >
                                {{ t('interactive.step4.scoreRange') }}: {{ selectedScoreRange.min.toLocaleString() }} ~ {{ selectedScoreRange.max.toLocaleString() }}
                            </span>
                        </div>

                        <!-- Song grid: multi-column compact cards -->
                        <div
                            v-if="step.songs.length > 0"
                            class="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                        >
                            <div
                                v-for="song in step.songs"
                                :key="`${song.songId}-${song.difficultyKey}`"
                                class="flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors cursor-pointer"
                                :class="[
                                    song.songName.includes('[FULL]') ? 'opacity-60' : '',
                                    selectedSongKey === `${i}-${song.songId}-${song.difficultyKey}`
                                        ? 'border-primary/60 bg-primary/8'
                                        : 'border-border/50 bg-surface/70 hover:border-border/80'
                                ]"
                                @click="toggleSong(i, song)"
                            >
                                <span
                                    class="shrink-0 rounded px-1 py-0.5 text-[10px] leading-none font-mono"
                                    :class="song.difficultyKey === '4' ? 'bg-purple-500/20 text-purple-400' :
                                            song.difficultyKey === '3' ? 'bg-red-500/20 text-red-400' :
                                            song.difficultyKey === '2' ? 'bg-yellow-500/20 text-yellow-400' :
                                            'bg-green-500/20 text-green-400'"
                                >
                                    {{ song.difficultyLabel }}
                                </span>
                                <Tooltip :content="`${song.songId}: ${song.songName}`" class="truncate min-w-0">
                                    {{ song.songName }}
                                </Tooltip>
                            </div>
                        </div>
                        <div
                            v-else
                            class="text-xs text-muted px-2 py-3 text-center"
                        >
                            {{ t('interactive.step4.noSongsForStep') }}
                        </div>
                    </div>
                </template>

                <!-- Not feasible -->
                <template v-else>
                    <!-- No fixed-PT songs at all -->
                    <div
                        v-if="hasNoFixedSongs"
                        class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                    >
                        <p class="text-sm text-muted mb-1">
                            ⚠️ {{ t('interactive.status.noFixedSongs') }}
                        </p>
                        <p class="text-xs text-muted">
                            {{ t('interactive.status.noFixedSongsHint') }}
                        </p>
                    </div>
                    <!-- Target too low -->
                    <div
                        v-else-if="analysisResult.targetTooLow"
                        class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                    >
                        <p class="text-sm text-muted mb-1">
                            ⚠️ {{ t('interactive.status.targetTooLow') }}
                        </p>
                        <p class="text-xs text-muted">
                            {{ t('interactive.status.targetTooLowHint', { min: (analysisResult.boostLevels[0]?.achievableBasePTs?.[0] ?? 0).toLocaleString() }) }}
                        </p>
                    </div>
                    <!-- No solution found -->
                    <div v-else>
                        <div class="rounded border border-border/80 bg-surface/50 p-3 mb-3">
                            <p class="text-sm text-muted mb-2">
                                ⚠️ {{ t('interactive.step4.noSolution') }}
                            </p>
                            <p class="text-xs text-muted">
                                {{ t('interactive.step4.maxAchievable', { pt: (analysisResult.maxAchievablePT ?? 0).toLocaleString() }) }}
                            </p>
                            <p class="mt-2 text-xs text-muted">
                                {{ t('interactive.step4.adjustConfigHint') }}
                            </p>
                        </div>

                        <!-- Contiguous windows -->
                        <div
                            v-if="analysisResult.contiguousWindows && analysisResult.contiguousWindows.length > 0"
                            class="rounded border border-primary/30 bg-primary/5 p-3 mb-3"
                        >
                            <p class="mb-2 text-xs font-medium text-text">{{ t('interactive.step4.windowPreview') }}</p>
                            <div class="space-y-2">
                                <div v-for="w in analysisResult.contiguousWindows" :key="w.plays">
                                    <p class="text-xs text-muted mb-0.5">{{ t('interactive.step4.playsLabel', { plays: w.plays }) }}</p>
                                    <p
                                        v-for="(seg, si) in w.segments"
                                        :key="si"
                                        class="text-xs text-muted ml-3"
                                        :class="si === 0 ? '' : 'opacity-60'"
                                    >
                                        <span v-if="si === 0">★ </span><span v-else>  </span>
                                        <span class="font-mono text-text">[{{ seg.lo.toLocaleString() }}, {{ seg.hi.toLocaleString() }}]</span>
                                        （{{ t('interactive.step4.segmentLen', { center: seg.center.toLocaleString(), len: (seg.hi - seg.lo + 1).toLocaleString() }) }}）
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Bonus adjustment suggestions -->
                        <div
                            v-if="analysisResult.feasibleBonuses && analysisResult.feasibleBonuses.length > 0"
                            class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                        >
                            <div class="mb-2 text-sm font-medium text-text">
                                {{ t('interactive.step4.adjustBonus') }}
                            </div>
                            <p class="mb-2 text-xs text-muted">
                                {{ t('interactive.step4.adjustBonusHint') }}
                            </p>
                            <div class="overflow-hidden rounded border border-border/60">
                                <table class="w-full border-collapse text-sm">
                                    <thead>
                                    <tr class="border-b border-border/60 bg-surface/30">
                                        <th class="px-3 py-1.5 text-left font-normal text-muted">
                                            {{ t('interactive.step4.bonusTableBonus') }}
                                        </th>
                                        <th class="px-3 py-1.5 text-right font-normal text-muted">
                                            {{ t('interactive.step4.bonusTableScore') }}
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    <tr
                                        v-for="res in analysisResult.feasibleBonuses.slice(0, 20)"
                                        :key="res.bonus"
                                        class="border-b border-border/40 hover:bg-surface/30"
                                    >
                                        <td class="px-3 py-1.5 font-mono font-bold text-primary">
                                            {{ res.bonus }}%
                                        </td>
                                        <td class="px-3 py-1.5 text-right font-mono">
                                            <span class="text-text">{{ res.scoreRange.min.toLocaleString() }}</span>
                                            <span class="mx-2 text-muted">-</span>
                                            <span class="text-text">{{ res.scoreRange.max.toLocaleString() }}</span>
                                        </td>
                                    </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                    </div>
                </template>
            </template>
        </div>

        <!-- ═══════ Navigation buttons ═══════ -->
        <div class="flex items-center justify-between gap-3">
            <button
                v-if="currentStep > 1"
                type="button"
                class="app-btn border border-border/80 bg-surface/90 px-4 py-1.5 text-sm text-text transition-colors hover:bg-surface"
                @click="prevStep"
            >
                ← {{ t('interactive.btn.prev') }}
            </button>
            <div v-else class="flex-1" />

            <button
                v-if="currentStep < 3"
                type="button"
                class="app-btn border border-border/80 bg-surface/90 px-4 py-1.5 text-sm text-text transition-colors hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!isStepValid"
                @click="nextStep"
            >
                {{ t('interactive.btn.next') }} →
            </button>

            <button
                v-if="currentStep === 3"
                type="button"
                class="app-btn border border-primary/40 bg-primary/15 px-4 py-1.5 text-sm text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!isStepValid || computing"
                @click="goToStep(4)"
            >
                🔍 {{ t('interactive.btn.analyze') }}
            </button>

        </div>
    </div>
</template>
