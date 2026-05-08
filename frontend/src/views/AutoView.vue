<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { calcEventPT } from "@/features/PT/calcSinglePT";
import { calcScore } from "@/features/songMeta/autoScoreMath";
import { useI18n } from "@/i18n";
import { fetchMetadata } from "@/services/songMetadataApi";
import { fetchSongList } from "@/services/songsApi";
import type { Skill, SongChartMeta, SongLevelSummary } from "@/types/songMetadata";
import { MusicDataResponse } from "@/types/songs";

const { t } = useI18n();
// 活动类型选项
const ACTIVITY_TYPES = [
    { value: "mission", label: t("eventType.mission") },
    { value: "try", label: t("eventType.try") },
    { value: "challenge", label: t("eventType.challenge") },
    { value: "versus", label: t("eventType.versus") },
    { value: "5v5", label: t("eventType.5v5") },
    { value: "medley1", label: t("eventType.medley1") },
] as const;

type ActivityType = (typeof ACTIVITY_TYPES)[number]["value"];

// 技能时长选项
const DURATION_OPTIONS = ["3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0"] as const;

// localStorage key
const STORAGE_KEYS = {
    FORM_DATA: "autoView_formData",
    SKILLS: "autoView_skills",
    CENTER_INDEX: "autoView_centerIndex",
    FILTER_OPTIONS: "autoView_filterOptions",
} as const;

// 默认表单数据
const defaultFormData = {
    activityType: "mission" as ActivityType,
    totalPower: 300000,
    supportBandPower: 0,
    eventBonus: 0,
    autoPara: 0.75,
};

// 默认技能组
const defaultSkills: Skill[] = [
    { duration: "7.0", scoreUp: 1.5 },
    { duration: "7.0", scoreUp: 1.5 },
    { duration: "7.0", scoreUp: 1.55 },
    { duration: "7.0", scoreUp: 1.3 },
    { duration: "7.0", scoreUp: 1.3 },
];

const defaultCenterIndex = 2; // 默认第3个技能为队长

// 添加 auto 倍率预设选项
const AUTO_PRESETS = [
    { id: "cn", label: t("auto.server.cn"), value: 0.5 },
    { id: "jp", label: t("auto.server.jp"), value: 0.75 },
    { id: "others", label: t("auto.server.others"), value: 1 }, // null 表示使用自定义输入
] as const;
const defaultAutoPreset = "jp";
// 添加当前选择的预设
const autoPreset = ref<"jp" | "cn" | "others">(defaultAutoPreset);

const defaultFilterOptions = {
    showOnlyFixedPT: false,
};

// 排序配置
type SortKey = "songId" | "difficulty" | "minAutoScore" | "maxAutoScore" | "minPT" | "maxPT";
type SortOrder = "asc" | "desc";

const sortConfig = ref<{
    key: SortKey;
    order: SortOrder;
}>({
    key: "songId",
    order: "asc",
});

// 从 localStorage 加载数据
const loadFromStorage = () => {
    try {
        const savedFormData = localStorage.getItem(STORAGE_KEYS.FORM_DATA);
        if (savedFormData) {
            const parsed = JSON.parse(savedFormData);
            formData.value = { ...defaultFormData, ...parsed };
        }

        const savedSkills = localStorage.getItem(STORAGE_KEYS.SKILLS);
        if (savedSkills) {
            const parsed = JSON.parse(savedSkills);
            if (Array.isArray(parsed) && parsed.length === 5) {
                skills.value = parsed;
            }
        }

        const savedCenterIndex = localStorage.getItem(STORAGE_KEYS.CENTER_INDEX);
        if (savedCenterIndex !== null) {
            centerIndex.value = Number.parseInt(savedCenterIndex, 10);
        }

        const savedFilterOptions = localStorage.getItem(STORAGE_KEYS.FILTER_OPTIONS);
        if (savedFilterOptions) {
            const parsed = JSON.parse(savedFilterOptions);
            filterOptions.value = { ...defaultFilterOptions, ...parsed };
        }
    } catch (err) {
        console.error("Failed to load from localStorage:", err);
    }
};

// 保存表单数据到 localStorage
const saveFormData = () => {
    localStorage.setItem(STORAGE_KEYS.FORM_DATA, JSON.stringify(formData.value));
};

// 保存技能组
const saveSkills = () => {
    localStorage.setItem(STORAGE_KEYS.SKILLS, JSON.stringify(skills.value));
};

// 保存队长索引
const saveCenterIndex = () => {
    localStorage.setItem(STORAGE_KEYS.CENTER_INDEX, String(centerIndex.value));
};

// 保存筛选选项
const saveFilterOptions = () => {
    localStorage.setItem(STORAGE_KEYS.FILTER_OPTIONS, JSON.stringify(filterOptions.value));
};

// 表单数据
const formData = ref(defaultFormData);

// 筛选选项
const filterOptions = ref(defaultFilterOptions);

// 5个技能
const skills = ref<Skill[]>([...defaultSkills]);

// 队长索引 (0-4)
const centerIndex = ref(defaultCenterIndex);

// 数据状态
const loading = ref(false);
const error = ref("");
const songMetadata = ref<SongChartMeta>({});
const songList = ref<MusicDataResponse>({});
const allResults = ref<
    Array<{
        songId: number;
        songName: string;
        difficulty: string;
        minAutoScore: number;
        maxAutoScore: number;
        minPT: number;
        maxPT: number;
    }>
>([]);

// 队长技能（计算属性）
const centerSkill = computed(() => skills.value[centerIndex.value]);

const difficultyDict = {
    "0": "easy",
    "1": "normal",
    "2": "hard",
    "3": "expert",
    "4": "special",
};
// 排序函数
const sortResults = (data: typeof allResults.value) => {
    const { key, order } = sortConfig.value;
    const multiplier = order === "asc" ? 1 : -1;

    return [...data].sort((a, b) => {
        let aVal: number | string = a[key];
        let bVal: number | string = b[key];

        if (key === "difficulty") {
            const aNum = Number.parseInt(aVal as string, 10);
            const bNum = Number.parseInt(bVal as string, 10);
            if (aNum !== bNum) {
                return (aNum - bNum) * multiplier;
            }
        } else {
            if (aVal !== bVal) {
                return ((aVal as number) - (bVal as number)) * multiplier;
            }
        }

        return a.songId - b.songId;
    });
};

// 处理排序点击
const handleSort = (key: SortKey) => {
    if (sortConfig.value.key === key) {
        sortConfig.value.order = sortConfig.value.order === "asc" ? "desc" : "asc";
    } else {
        sortConfig.value = { key, order: "asc" };
    }
};

// 获取排序图标
const getSortIcon = (key: SortKey) => {
    if (sortConfig.value.key !== key) return "↕️";
    return sortConfig.value.order === "asc" ? "↑" : "↓";
};

// 筛选后的结果
const filteredResults = computed(() => {
    let data = allResults.value;

    if (filterOptions.value.showOnlyFixedPT) {
        data = data.filter((row) => row.minPT === row.maxPT);
    }

    return sortResults(data);
});

// 监听变化自动保存
watch(formData, () => saveFormData(), { deep: true });
watch(skills, () => saveSkills(), { deep: true });
watch(centerIndex, () => saveCenterIndex());
watch(filterOptions, () => saveFilterOptions(), { deep: true });

// 加载歌曲元数据
const loadMetadata = async () => {
    try {
        songMetadata.value = await fetchMetadata();
    } catch (err) {
        console.error("Failed to load song metadata:", err);
        error.value = t("auto.error.loadMetadata");
    }
};
const loadSongList = async () => {
    try {
        songList.value = await fetchSongList();
    } catch (err) {
        console.error("Failed to load song list:", err);
        error.value = t("auto.error.loadSongList");
    }
};

// 是否显示副队输入
const showSupportBand = computed(() => formData.value.activityType === "mission");
// 是否显示加成输入
const showEventBonus = computed(
    () => formData.value.activityType === "mission" || formData.value.activityType === "try" || formData.value.activityType === "challenge",
);

// 更新技能
const updateSkill = (index: number, field: keyof Skill, value: string | number) => {
    skills.value[index] = { ...skills.value[index], [field]: value };
};

// 重置技能为默认值
const resetSkills = () => {
    skills.value = JSON.parse(JSON.stringify(defaultSkills));
    centerIndex.value = defaultCenterIndex;
};

// 监听预设变化，自动填充 autoPara
const handleAutoPresetChange = () => {
    const preset = AUTO_PRESETS.find((p) => p.id === autoPreset.value);
    if (preset && preset.value !== null) {
        formData.value.autoPara = preset.value;
    }
};

// 监听 autoPara 变化，如果是预设值则自动切换到对应的预设
const updateAutoPreset = () => {
    if (formData.value.autoPara === AUTO_PRESETS.find((p) => p.id === "cn")?.value) {
        autoPreset.value = "cn";
    } else if (formData.value.autoPara === AUTO_PRESETS.find((p) => p.id === "jp")?.value) {
        autoPreset.value = "jp";
    } else {
        autoPreset.value = "others";
    }
};

// 监听 autoPara 变化
watch(
    () => formData.value.autoPara,
    () => {
        updateAutoPreset();
    },
);

// 监听预设变化
watch(autoPreset, () => {
    handleAutoPresetChange();
});

// 重置所有设置
const resetAllSettings = () => {
    formData.value = JSON.parse(JSON.stringify(defaultFormData));
    filterOptions.value = JSON.parse(JSON.stringify(defaultFilterOptions));
    resetSkills();
    sortConfig.value = { key: "songId", order: "asc" };
    autoPreset.value = "jp"; // 重置预设
};

// 初始化加载数据
onMounted(() => {
    loadFromStorage();
    loadMetadata();
    loadSongList();
    updateAutoPreset(); // 初始化时同步预设状态
});
// 计算单个歌曲
const calculateSong = (songId: number, songSummary: SongLevelSummary, difficultyKey: string) => {
    try {
        const scoreResult = calcScore(formData.value.totalPower, skills.value, centerSkill.value, songSummary, formData.value.autoPara);

        const minScore = Math.floor(scoreResult.minScore);
        const maxScore = Math.floor(scoreResult.maxScore);

        let minPT: number;
        let maxPT: number;

        switch (formData.value.activityType) {
            case "mission":
                minPT = calcEventPT(minScore, {
                    type: "mission",
                    supportBandPower: formData.value.supportBandPower,
                    eventBonus: formData.value.eventBonus,
                });
                maxPT = calcEventPT(maxScore, {
                    type: "mission",
                    supportBandPower: formData.value.supportBandPower,
                    eventBonus: formData.value.eventBonus,
                });
                break;
            case "try":
                minPT = calcEventPT(minScore, {
                    type: "try",
                    eventBonus: formData.value.eventBonus,
                });
                maxPT = calcEventPT(maxScore, {
                    type: "try",
                    eventBonus: formData.value.eventBonus,
                });
                break;
            case "challenge":
                minPT = calcEventPT(minScore, {
                    type: "challenge",
                    eventBonus: formData.value.eventBonus,
                });
                maxPT = calcEventPT(maxScore, {
                    type: "challenge",
                    eventBonus: formData.value.eventBonus,
                });
                break;
            case "versus":
                minPT = calcEventPT(minScore, { type: "versus" });
                maxPT = calcEventPT(maxScore, { type: "versus" });
                break;
            case "5v5":
                minPT = calcEventPT(minScore, { type: "5v5" });
                maxPT = calcEventPT(maxScore, { type: "5v5" });
                break;
            case "medley1":
                minPT = calcEventPT(minScore, { type: "medley1" });
                maxPT = calcEventPT(maxScore, { type: "medley1" });
                break;
        }
        const musicTitle = songList.value?.[songId].musicTitle;
        const title = musicTitle?.filter(Boolean).at(0) ?? "unknown";
        return {
            songId,
            songName: title,
            difficulty: difficultyKey,
            minAutoScore: minScore,
            maxAutoScore: maxScore,
            minPT,
            maxPT,
        };
    } catch (err) {
        console.error(`[calc error] song ${songId} ${difficultyKey}:`, err);
        return null;
    }
};

// 计算所有歌曲
const calculate = () => {
    if (!songMetadata.value || Object.keys(songMetadata.value).length === 0) {
        error.value = t("auto.error.metadataNotReady");
        return;
    }

    loading.value = true;
    error.value = "";
    allResults.value = [];

    try {
        const newResults: typeof allResults.value = [];

        for (const [songIdStr, songSummary] of Object.entries(songMetadata.value)) {
            const songId = Number.parseInt(songIdStr, 10);

            for (let i = 0; i <= 3; i++) {
                const difficultyKey = i.toString() as "0" | "1" | "2" | "3";
                const levelSummary = songSummary[difficultyKey];
                if (!levelSummary) continue;

                const result = calculateSong(songId, levelSummary, difficultyKey);
                if (result) newResults.push(result);
            }

            if (songSummary["4"]) {
                const result = calculateSong(songId, songSummary["4"], "4");
                if (result) newResults.push(result);
            }
        }

        allResults.value = newResults;
    } catch (err) {
        console.error("calc failed:", err);
        error.value = t("auto.error.calcFailed");
    } finally {
        loading.value = false;
    }
};
</script>
<template>
    <div class="grid gap-3">
        <div class="grid gap-4 md:grid-cols-2">
            <div class="rounded border border-border/80 bg-surface/50 p-3">
                <div class="mb-2 text-sm font-medium">{{ t('auto.config.eventParams') }}</div>
                <div class="space-y-3">
                    <div class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.eventType') }}</span>
                        <select
                            v-model="formData.activityType"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        >
                            <option v-for="type in ACTIVITY_TYPES" :key="type.value" :value="type.value">
                                {{ type.label }}
                            </option>
                        </select>
                    </div>

                    <div class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.totalPower') }}</span>
                        <input
                            v-model.number="formData.totalPower"
                            type="number"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>

                    <div v-if="showSupportBand" class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.supportPower') }}</span>
                        <input
                            v-model.number="formData.supportBandPower"
                            type="number"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>

                    <div v-if="showEventBonus" class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.eventBonus') }}</span>
                        <input
                            v-model.number="formData.eventBonus"
                            type="number"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                        />
                    </div>

                    <div class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('auto.config.autoRate') }}</span>
                        <div class="flex flex-1 gap-2">
                            <select
                                v-model="autoPreset"
                                class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
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
                                step="0.01"
                                class="w-28 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text"
                                :placeholder="t('auto.config.ratePlaceholder')"
                            />
                            <span v-else class="w-28 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text">
                                {{ t('auto.config.rateLabel') }} {{ formData.autoPara }}
                            </span>
                        </div>
                    </div>

                    <div class="flex gap-2 pt-2">
                        <button
                            type="button"
                            class="app-btn border border-border/80 bg-surface/90 px-4 py-1.5 text-sm text-text transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                            :disabled="loading"
                            @click="calculate"
                        >
                            {{ loading ? t('common.calculating') : t('common.calculate') }}
                        </button>
                        <button
                            type="button"
                            class="app-btn border border-border/80 bg-surface/90 px-3 py-1.5 text-sm text-muted transition-colors hover:text-text"
                            @click="resetAllSettings"
                        >
                            {{ t('common.resetAll') }}
                        </button>
                    </div>
                </div>
            </div>

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

                <div class="mb-3 flex items-center gap-3 pb-2">
                    <label class="flex items-center gap-2 text-sm text-muted">
                        <input
                            v-model="filterOptions.showOnlyFixedPT"
                            type="checkbox"
                            class="h-4 w-4 rounded border-border/80"
                        />
                        <span>{{ t('auto.config.filterFixedPt') }}</span>
                    </label>
                </div>

                <div class="space-y-2">
                    <div class="text-xs font-medium text-muted">{{ t('auto.config.skillOrderHint') }}</div>
                    <div class="grid gap-2">
                        <div v-for="(skill, idx) in skills" :key="idx" class="flex items-center gap-2">
                            <div class="flex items-center gap-1">
                                <input
                                    type="radio"
                                    :checked="centerIndex === idx"
                                    class="h-3.5 w-3.5"
                                    @change="centerIndex = idx"
                                />
                                <span class="w-8 text-xs" :class="centerIndex === idx ? 'text-primary' : 'text-muted'">
                                    {{ idx + 1 }}
                                </span>
                            </div>
                            <select
                                :value="skill.duration"
                                class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm"
                                @change="updateSkill(idx, 'duration', ($event.target as HTMLSelectElement).value)"
                            >
                                <option v-for="opt in DURATION_OPTIONS" :key="opt" :value="opt">
                                    {{ opt }}{{ t('common.unitSecond') }}
                                </option>
                            </select>
                            <input
                                :value="skill.scoreUp"
                                type="number"
                                step="0.01"
                                class="w-24 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-left"
                                @input="updateSkill(idx, 'scoreUp', parseFloat(($event.target as HTMLInputElement).value))"
                            />
                            <span class="w-8 text-xs text-muted">{{ t('auto.config.skillRateLabel') }}</span>
                        </div>
                    </div>
                </div>

                <div class="mt-2 text-xs text-muted">
                    <p>{{ t('auto.config.skillNote') }}</p>
                    <span class="text-primary">● {{ t('auto.config.skillCenterHint') }}</span>
                </div>
            </div>
        </div>

        <p v-if="error" class="border border-border/80 bg-surface px-3 py-2 text-sm text-muted">
            {{ error }}
        </p>

        <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm">
                <thead>
                <tr class="border-b border-border/80 bg-surface/50">
                    <th
                        class="cursor-pointer px-3 py-2 text-left hover:bg-surface/50"
                        @click="handleSort('songId')"
                    >
                        {{ t('auto.table.songId') }} {{ getSortIcon('songId') }}
                    </th>
                    <th class="px-3 py-2 text-left">
                        {{ t('auto.table.songName') }}
                    </th>
                    <th
                        class="cursor-pointer px-3 py-2 text-left hover:bg-surface/50"
                        @click="handleSort('difficulty')"
                    >
                        {{ t('auto.table.difficulty') }} {{ getSortIcon('difficulty') }}
                    </th>
                    <th
                        class="cursor-pointer px-3 py-2 text-right hover:bg-surface/50"
                        @click="handleSort('minAutoScore')"
                    >
                        {{ t('auto.table.minScore') }} {{ getSortIcon('minAutoScore') }}
                    </th>
                    <th
                        class="cursor-pointer px-3 py-2 text-right hover:bg-surface/50"
                        @click="handleSort('maxAutoScore')"
                    >
                        {{ t('auto.table.maxScore') }} {{ getSortIcon('maxAutoScore') }}
                    </th>
                    <th
                        class="cursor-pointer px-3 py-2 text-right hover:bg-surface/50"
                        @click="handleSort('minPT')"
                    >
                        {{ t('auto.table.minPt') }} {{ getSortIcon('minPT') }}
                    </th>
                    <th
                        class="cursor-pointer px-3 py-2 text-right hover:bg-surface/50"
                        @click="handleSort('maxPT')"
                    >
                        {{ t('auto.table.maxPt') }} {{ getSortIcon('maxPT') }}
                    </th>
                </tr>
                </thead>
                <tbody>
                <tr
                    v-for="row in filteredResults"
                    :key="`${row.songId}-${row.difficulty}`"
                    class="border-b border-border/60 hover:bg-surface/30"
                >
                    <td class="px-3 py-2">{{ row.songId }}</td>
                    <td class="px-3 py-2">{{ row.songName }}</td>
                    <td class="px-3 py-2">{{ difficultyDict[row.difficulty as keyof typeof difficultyDict] }}</td>
                    <td class="px-3 py-2 text-right font-mono">{{ row.minAutoScore.toLocaleString() }}</td>
                    <td class="px-3 py-2 text-right font-mono">{{ row.maxAutoScore.toLocaleString() }}</td>
                    <td class="px-3 py-2 text-right font-mono">{{ row.minPT.toLocaleString() }}</td>
                    <td class="px-3 py-2 text-right font-mono">{{ row.maxPT.toLocaleString() }}</td>
                </tr>
                <tr v-if="filteredResults.length === 0 && !loading && allResults.length > 0">
                    <td colspan="7" class="px-3 py-8 text-center text-muted">
                        {{ t('auto.table.emptyFiltered') }}
                    </td>
                </tr>
                <tr v-if="filteredResults.length === 0 && !loading && allResults.length === 0">
                    <td colspan="7" class="px-3 py-8 text-center text-muted">
                        {{ t('auto.table.emptyPrompt') }}
                    </td>
                </tr>
                <tr v-if="loading">
                    <td colspan="7" class="px-3 py-8 text-center text-muted">
                        {{ t('common.loading') }}
                    </td>
                </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>