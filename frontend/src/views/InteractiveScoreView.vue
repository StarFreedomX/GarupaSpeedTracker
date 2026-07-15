<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import EventParamsPanel from "@/components/common/EventParamsPanel.vue";
import PlayerDeckFetcher from "@/components/common/PlayerDeckFetcher.vue";
import SkillConfigPanel from "@/components/common/SkillConfigPanel.vue";
import Tooltip from "@/components/common/Tooltip.vue";
import { sanitizeIntInput } from "@/composables/inputFilters";
import { useUserPreferences } from "@/composables/useUserPreferences";
import { getScoreRangeByPT } from "@/features/PT/calcSinglePT";
import { analyze, computeFixedBasePTs, findContiguousWindows } from "@/features/scoreControl/interactiveAnalysis";
import type { ActivityType, AnalysisResult, PlayStep, SolutionFilter, TeamConfig } from "@/features/scoreControl/types";
import { calcExactScoreInTurns, calcScore } from "@/features/songMeta/autoScoreMath";
import { useI18n } from "@/i18n";
import { fetchMetadata } from "@/services/songMetadataApi";
import { fetchSongList } from "@/services/songsApi";
import type { ServerKey } from "@/types/points";
import type { Skill, SongChartMeta } from "@/types/songMetadata";
import type { MusicDataResponse } from "@/types/songs";

// ─── i18n ───
const { t } = useI18n();

// ─── BPM rounding bug warning ───
const AFFECTED_BPMS = [137, 154];
const affectedBPMsText = computed(() => AFFECTED_BPMS.join("、"));

// ─── localStorage keys ───
const STORAGE_KEYS = {
    FORM_DATA: "scoreCalc_formData",
    SKILLS: "scoreCalc_skills",
    CENTER_INDEX: "scoreCalc_centerIndex",
} as const;

// ─── activity type options ───
const ACTIVITY_TYPES = computed(() => [
    { value: "mission" as const, label: t("eventType.mission"), icon: "📋" },
    { value: "try" as const, label: t("eventType.try"), icon: "✅" },
    { value: "challenge" as const, label: t("eventType.challenge"), icon: "🟣" },
    { value: "versus" as const, label: t("eventType.versus"), icon: "⚔️" },
    { value: "5v5" as const, label: t("eventType.5v5"), icon: "🏟️" },
    { value: "medley1" as const, label: t("eventType.medley1"), icon: "🎵" },
]);

// ─── auto presets ───
const AUTO_PRESETS = computed(() => [
    { id: "nonJp" as const, label: t("auto.server.nonJp"), value: 0.5 },
    { id: "jp" as const, label: t("auto.server.jp"), value: 0.75 },
    { id: "custom" as const, label: t("auto.server.custom"), value: null },
]);

// ─── defaults ───
const defaultFormData = {
    activityType: "mission" as ActivityType,
    targetPT: 300,
    totalPower: 300000,
    supportBandPower: 0,
    eventBonus: 0,
    autoPara: 0.75,
    fps: 120 as 60 | 120,
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
const autoPreset = ref<"jp" | "nonJp" | "custom">("jp");
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

// 目标 PT 步骤的区间预览（手动触发，避免每次参数变更都重算）
const previewWindows = ref<ReturnType<typeof findContiguousWindows> | null>(null);
const previewLoading = ref(false);

const computePreviewWindows = () => {
    if (Object.keys(songMetadata.value).length === 0) return;
    if (Object.keys(songList.value).length === 0) return;
    previewLoading.value = true;
    setTimeout(() => {
        try {
            const { achievableBasePTs } = computeFixedBasePTs(
                teamConfig.value,
                formData.value.activityType,
                songMetadata.value,
                songList.value,
                filterData.value,
            );
            if (achievableBasePTs.length === 0) {
                previewWindows.value = null;
            } else {
                previewWindows.value = findContiguousWindows(achievableBasePTs);
            }
        } catch {
            previewWindows.value = null;
        } finally {
            previewLoading.value = false;
        }
    }, 30);
};

const isStepValid = computed(() => {
    switch (currentStep.value) {
        case 1:
            return formData.value.totalPower > 0 && skills.value.length === 5;
        case 2:
            return formData.value.targetPT > 0 && formData.value.targetPT <= 10000000;
        default:
            return true;
    }
});

// ─── step navigation ───
const nextStep = () => {
    if (currentStep.value < 3 && isStepValid.value) {
        currentStep.value++;
        if (currentStep.value === 3) {
            runAnalysis();
        }
    }
};

const prevStep = () => {
    if (currentStep.value > 1) {
        currentStep.value--;
        // 回到配置步骤时清除旧结果
        if (currentStep.value < 3) {
            analysisResult.value = null;
        }
    }
};

const goToStep = (step: number) => {
    currentStep.value = step;
    if (step === 3) {
        runAnalysis();
    } else {
        analysisResult.value = null;
    }
};

// ─── auto preset logic ───
watch(
    () => formData.value.autoPara,
    () => {
        if (formData.value.autoPara === AUTO_PRESETS.value.find((p) => p.id === "nonJp")?.value) {
            autoPreset.value = "nonJp";
        } else if (formData.value.autoPara === AUTO_PRESETS.value.find((p) => p.id === "jp")?.value) {
            autoPreset.value = "jp";
        } else {
            autoPreset.value = "custom";
        }
    },
);

// ─── skill helpers ───
const updateSkill = (index: number, field: keyof Skill, value: string | number) => {
    skills.value[index] = { ...skills.value[index], [field]: value };
};

// 切换叠p技能开关
const updateSkillProgressiveToggle = (index: number, enabled: boolean) => {
    const skill = skills.value[index];
    skills.value[index] = {
        ...skill,
        progressive: enabled ? { stepRate: 0.005, maxCap: 1.5 } : undefined,
    };
};

// 更新叠p技能参数
const updateSkillProgressive = (index: number, field: "stepRate" | "maxCap", value: number) => {
    const skill = skills.value[index];
    if (!skill.progressive) return;
    skills.value[index] = {
        ...skill,
        progressive: { ...skill.progressive, [field]: value },
    };
};

const resetSkills = () => {
    skills.value = JSON.parse(JSON.stringify(defaultSkills));
    centerIndex.value = defaultCenterIndex;
};

// ─── 从玩家数据填充队伍配置 ───
const onDeckFetched = (data: {
    totalPower: number;
    eventBonus: number;
    activityType: ActivityType;
    skills: Skill[];
    server: ServerKey;
    eventId: number;
    eventName: string;
    warnings: string[];
}) => {
    formData.value.totalPower = data.totalPower;
    formData.value.eventBonus = data.eventBonus;
    formData.value.activityType = data.activityType;
    skills.value = data.skills;
    centerIndex.value = 2; // 默认中间为队长
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
    if (currentStep.value !== 3) return;
    if (e.key === "ArrowRight") {
        e.preventDefault();
        goNextAlternative();
    } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevAlternative();
    }
};

// 歌曲选中状态 & 分数范围
// ─── 反推 PT 对应的分数范围 ───
const ptScoreRangeParams = computed(() => {
    switch (formData.value.activityType) {
        case "mission":
            return { type: "mission" as const, supportBandPower: formData.value.supportBandPower, eventBonus: formData.value.eventBonus };
        case "try":
            return { type: "try" as const, eventBonus: formData.value.eventBonus };
        case "challenge":
            return { type: "challenge" as const, eventBonus: formData.value.eventBonus };
        case "versus":
            return { type: "versus" as const };
        case "5v5":
            return { type: "5v5" as const };
        case "medley1":
            return { type: "medley1" as const };
    }
});

function getPTScoreRange(basePT: number): { min: number; max: number } | null {
    try {
        return getScoreRangeByPT(basePT, ptScoreRangeParams.value);
    } catch {
        return null;
    }
}

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
    localStorage.setItem("scoreCalc_filter", JSON.stringify(filterData.value));
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
        const savedFilter = localStorage.getItem("scoreCalc_filter");
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
    if (formData.value.autoPara === 0.5) autoPreset.value = "nonJp";
    else if (formData.value.autoPara === 0.75) autoPreset.value = "jp";
    else autoPreset.value = "custom";
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

/** 筛选 feasibleBonuses：始终展示全部加成建议 */
const filteredFeasibleBonuses = computed(() => {
    return analysisResult.value?.feasibleBonuses ?? [];
});

// ─── bonus → recommended total power ───
/** 二分反推：给定目标分数，计算所需综合力 */
function reverseCalcPower(
    targetScore: number,
    orderedSkills: Skill[],
    centerSkill: Skill,
    songLevelSummary: { level: number; total: number; counts: Record<string, number[]> },
    autoPara: number,
): number {
    const skills = [...orderedSkills, centerSkill];
    let lo = 1;
    let hi = 500_000;
    for (let i = 0; i < 32; i++) {
        const mid = Math.floor((lo + hi) / 2);
        const score = calcExactScoreInTurns(mid, skills, songLevelSummary, autoPara, formData.value.fps);
        if (score < targetScore) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return Math.floor((lo + hi) / 2);
}

/** 加成行（含推荐综合力） */
const { preferences: appPreferences } = useUserPreferences();

const bonusRows = computed(() => {
    const bonuses = filteredFeasibleBonuses.value;
    if (bonuses.length === 0) return [];

    // 获取固定PT歌曲列表
    const meta = songMetadata.value;
    if (!meta || Object.keys(meta).length === 0) return [];
    const cfg = teamConfig.value;
    const center = skills.value[cfg.centerIndex];
    if (!center) return [];

    try {
        const { songMap } = computeFixedBasePTs(cfg, formData.value.activityType, meta, songList.value, filterData.value);
        const allSongs: { songId: number; difficultyKey: string; basePT: number }[] = [];
        for (const songs of songMap.values()) {
            for (const s of songs) {
                allSongs.push({ songId: s.songId, difficultyKey: s.difficultyKey, basePT: s.basePT });
            }
        }
        if (allSongs.length === 0) return [];

        // 按 basePT 排序取中位数
        allSongs.sort((a, b) => a.basePT - b.basePT);
        const median = allSongs[Math.floor(allSongs.length / 2)];

        // 找到对应谱面数据
        const songSummary = meta[median.songId];
        const levelSummary = songSummary?.[median.difficultyKey as "0" | "1" | "2" | "3" | "4"];
        if (!levelSummary) return [];

        // 计算最优技能顺序
        const { maxPath } = calcScore(cfg.totalPower, cfg.skills, center, levelSummary, cfg.autoPara, formData.value.fps);
        const orderedSkills = new Array<Skill>(5);
        maxPath.forEach((posIdx, skillIdx) => {
            orderedSkills[posIdx] = cfg.skills[skillIdx];
        });

        // 为每个加成反推综合力，按设置中的推荐综合力范围过滤
        const minPower = appPreferences.calculator.minRecPower;
        const maxPower = appPreferences.calculator.maxRecPower;
        const rows: { bonus: number; recommendedPower: number }[] = [];
        for (const b of bonuses) {
            const avgScore = Math.floor((b.scoreRange.min + b.scoreRange.max) / 2);
            const power = reverseCalcPower(avgScore, orderedSkills, center, levelSummary, cfg.autoPara);
            if (power >= minPower && power <= maxPower) {
                rows.push({ bonus: b.bonus, recommendedPower: power });
            }
        }
        return rows;
    } catch {
        return [];
    }
});
</script>

<template>
    <div class="grid gap-3">
        <!-- ─── Step indicator ─── -->
        <div class="rounded border border-border/80 bg-surface/50 p-3">
            <div class="flex items-center gap-4">
                <span class="text-sm font-medium text-text">
                    {{ t('interactive.step', { current: currentStep, total: 3 }) }}
                </span>
                <div class="flex gap-1.5">
                    <button
                        v-for="s in 3"
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
                    {{ currentStep === 1 ? t('interactive.step2.title')
                        : currentStep === 2 ? t('interactive.step3.title')
                        : t('interactive.step4.title') }}
                </span>
            </div>
        </div>

        <!-- ═══════ Step 2: Target PT ═══════ -->
        <div
            v-if="currentStep === 2"
            class="rounded border border-border/80 bg-surface/50 p-3"
        >
            <div class="mb-3 text-sm font-medium">{{ t('interactive.step3.title') }}</div>
            <div class="mx-auto max-w-md">
                <div class="flex items-center gap-3">
                    <span class="w-20 text-sm text-muted">{{ t('interactive.step3.targetPt') }}</span>
                    <input
                        v-model.number="formData.targetPT"
                        type="text"
                        inputmode="numeric"
                        min="1"
                        max="10000000"
                        class="flex-1 rounded border border-border/80 bg-surface/90 px-3 py-2 text-lg text-text font-mono text-center"
                        :placeholder="t('interactive.step3.placeholder')"
                        @input="sanitizeIntInput"
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
                                type="text"
                                inputmode="numeric"
                                class="w-20 rounded border border-border/80 bg-surface/90 px-1.5 py-1 text-xs text-text disabled:opacity-40"
                                placeholder="ID"
                                @input="sanitizeIntInput"
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
                                v-model.lazy="filterData.boostString"
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
                <div class="mt-3 pt-3 border-t border-border/60">
                    <div class="flex items-center gap-2 mb-2">
                        <p class="text-xs font-medium text-text">{{ t('interactive.step4.windowPreview') }}</p>
                        <button
                            type="button"
                            class="app-btn border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                            :disabled="previewLoading"
                            @click="computePreviewWindows"
                        >
                            {{ previewLoading ? '...' : '↻ ' + t('common.calculate') }}
                        </button>
                    </div>
                    <template v-if="previewWindows && previewWindows.length > 0">
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
                    </template>
                    <p v-else-if="previewWindows && previewWindows.length === 0" class="text-xs text-muted">
                        {{ t('interactive.status.noFixedSongs') }}
                    </p>
                </div>
            </div>
        </div>

        <!-- ═══════ Step 1: Team config ═══════ -->
        <div v-if="currentStep === 1" class="grid gap-4">
            <PlayerDeckFetcher @deck-fetched="onDeckFetched" />

            <div class="grid gap-4 md:grid-cols-2">
            <EventParamsPanel
                :activity-type="formData.activityType"
                :total-power="formData.totalPower"
                :support-band-power="formData.supportBandPower"
                :event-bonus="formData.eventBonus"
                :auto-para="formData.autoPara"
                :auto-preset="autoPreset"
                :fps="formData.fps"
                :show-support-band="showSupportBand"
                :show-event-bonus="showEventBonus"
                :activity-type-editable="true"
                :activity-type-options="ACTIVITY_TYPES"
                @update:activity-type="formData.activityType = $event"
                @update:total-power="formData.totalPower = $event"
                @update:support-band-power="formData.supportBandPower = $event"
                @update:event-bonus="formData.eventBonus = $event"
                @update:auto-para="formData.autoPara = $event"
                @update:auto-preset="autoPreset = $event"
                @update:fps="formData.fps = $event"
            />

            <SkillConfigPanel
                :skills="skills"
                :center-index="centerIndex"
                @update:skill="updateSkill"
                @update:center-index="centerIndex = $event"
                @update:skill-progressive-toggle="updateSkillProgressiveToggle"
                @update:skill-progressive="updateSkillProgressive"
                @reset="resetSkills"
            />
        </div>
        </div>

        <!-- ═══════ Step 3: Results ═══════ -->
        <div v-if="currentStep === 3">
            <!-- BPM rounding warning -->
<!--            <div class="rounded border border-yellow-400 bg-yellow-100 p-3 mb-3">
                <div class="flex items-start gap-2">
                    <span class="text-lg shrink-0">⚠️</span>
                    <div class="space-y-1">
                        <p class="text-sm font-medium text-black">
                            {{ t('interactive.bpmWarning.title') }}
                        </p>
                        <p class="text-xs text-black/70">
                            {{ t('interactive.bpmWarning.description') }}
                        </p>
                        <p class="text-xs text-black/70">
                            {{ t('interactive.bpmWarning.affectedBPMs') }}：<span class="font-mono font-bold text-black">{{ affectedBPMsText }}</span>
                        </p>
                        <p class="text-xs text-black/70 mt-1">
                            💡 {{ t('interactive.bpmWarning.hint') }}
                        </p>
                    </div>
                </div>
            </div>-->

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
                                {{ t('interactive.step4.liveBoostCount', { count: step.boosts }) }}
                            </span>
                            <span class="text-xs text-muted">
                                {{ t('interactive.step4.basePT') }} = <span class="font-mono text-text">{{ step.basePT.toLocaleString() }}</span>
                                × {{ step.multiplier }}
                                = <span class="font-mono font-bold text-primary">{{ step.boostedPT.toLocaleString() }} PT</span>
                                <span v-if="getPTScoreRange(step.basePT)" class="text-[10px] text-muted/70 ml-1">
                                    [{{ getPTScoreRange(step.basePT)!.min.toLocaleString() }} ~ {{ getPTScoreRange(step.basePT)!.max.toLocaleString() }}]
                                </span>
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

                    <!-- Target too low warning -->
                    <div
                        v-if="analysisResult.targetTooLow"
                        class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                    >
                        <p class="text-sm text-muted mb-1">
                            ⚠️ {{ t('interactive.status.targetTooLow') }}
                        </p>
                        <p class="text-xs text-muted">
                            {{ t('interactive.status.targetTooLowHint', { min: (analysisResult.boostLevels[0]?.achievableBasePTs?.[0] ?? 0).toLocaleString() }) }}
                        </p>
                    </div>

                    <!-- No solution general info -->
                    <div
                        v-if="!hasNoFixedSongs && !analysisResult.targetTooLow"
                        class="rounded border border-border/80 bg-surface/50 p-3 mb-3"
                    >
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

                    <!-- Bonus adjustment suggestions (always shown when available) -->
                    <div
                        v-if="bonusRows.length > 0"
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
                                        {{ t('interactive.step4.bonusTablePower') }}
                                    </th>
                                </tr>
                                </thead>
                                <tbody>
                                <tr
                                    v-for="row in bonusRows"
                                    :key="row.bonus"
                                    class="border-b border-border/40 hover:bg-surface/30"
                                >
                                    <td class="px-3 py-1.5 font-mono font-bold text-primary">
                                        {{ row.bonus }}%
                                    </td>
                                    <td class="px-3 py-1.5 text-right font-mono text-text">
                                        {{ row.recommendedPower.toLocaleString() }}
                                    </td>
                                </tr>
                                </tbody>
                            </table>
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
                v-if="currentStep < 2"
                type="button"
                class="app-btn border border-border/80 bg-surface/90 px-4 py-1.5 text-sm text-text transition-colors hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!isStepValid"
                @click="nextStep"
            >
                {{ t('interactive.btn.next') }} →
            </button>

            <button
                v-if="currentStep === 2"
                type="button"
                class="app-btn border border-primary/40 bg-primary/15 px-4 py-1.5 text-sm text-primary transition-colors hover:bg-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="!isStepValid || computing"
                @click="goToStep(3)"
            >
                🔍 {{ t('interactive.btn.analyze') }}
            </button>

        </div>
    </div>
</template>
