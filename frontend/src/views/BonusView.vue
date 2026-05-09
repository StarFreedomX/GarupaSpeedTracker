<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { BonusParams, FeasibleBonusResult, getFeasibleBonus, MissionParams } from "@/features/PT/calcSinglePT";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const STORAGE_KEY = "bonusView_formData";

// 使用 t() 获取本地化标签
const ACTIVITY_TYPES = computed(
    () =>
        [
            { value: "mission", label: t("eventType.mission") },
            { value: "try", label: t("eventType.try") },
            { value: "challenge", label: t("eventType.challenge") },
        ] as const,
);

type ActivityType = "mission" | "try" | "challenge";

const formData = ref({
    activityType: "mission" as ActivityType,
    targetPT: 300,
    supportBandPower: 250000,
});

const results = ref<FeasibleBonusResult[]>([]);

const calculate = () => {
    // 基础校验：增加对 targetPT 的非零校验，避免页面初始化时显示错误
    if (
        !formData.value.targetPT ||
        formData.value.targetPT <= 0 ||
        formData.value.targetPT > 10000000 ||
        (formData.value.activityType === "mission" && formData.value.supportBandPower < 0)
    ) {
        results.value = [];
        return;
    }

    const params: BonusParams = { type: formData.value.activityType } as BonusParams;
    if (formData.value.activityType === "mission") {
        (params as Omit<MissionParams, "eventBonus">).supportBandPower = formData.value.supportBandPower;
    }

    results.value = getFeasibleBonus(formData.value.targetPT, params);
};

watch(
    formData,
    (next) => {
        // 保存到本地存储
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        // 实时触发计算
        calculate();
    },
    { deep: true, immediate: false }, // immediate 为 false 是为了等 onMounted 的恢复逻辑
);

const showSupportBand = computed(() => formData.value.activityType === "mission");

onMounted(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (["mission", "try", "challenge"].includes(parsed.activityType)) {
                // 这里的赋值会触发上面的 watch，从而自动执行一次 calculate
                formData.value = { ...formData.value, ...parsed };
            }
        } catch (e) {
            console.error("Failed to parse saved bonus formData", e);
        }
    }
});

watch(
    formData,
    (next) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    { deep: true },
);
</script>

<template>
    <div class="grid gap-3">
        <div class="rounded border border-border/80 bg-surface/50 p-3">
            <div class="mb-2 text-sm font-medium">{{ t('bonus.title') }}</div>
            <div class="space-y-3">
                <div class="grid gap-4 md:grid-cols-2">
                    <div class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('bonus.targetPt') }}</span>
                        <input
                            v-model.number="formData.targetPT"
                            type="number"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text font-mono"
                            :placeholder="t('bonus.targetPtPlaceholder')"
                            @keyup.enter="calculate"
                        />
                    </div>

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

                    <div v-if="showSupportBand" class="flex items-center gap-3">
                        <span class="w-20 text-sm text-muted">{{ t('bonus.supportPower') }}</span>
                        <input
                            v-model.number="formData.supportBandPower"
                            type="number"
                            class="flex-1 rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text font-mono"
                            @keyup.enter="calculate"
                        />
                    </div>
                </div>
            </div>
        </div>

        <div class="overflow-hidden rounded border border-border/80 bg-surface/50">
            <table class="w-full border-collapse text-sm">
                <thead>
                <tr class="border-b border-border/80 bg-surface/50">
                    <th class="px-3 py-2 text-left text-muted font-normal">{{ t('bonus.tableBonus') }}</th>
                    <th class="px-3 py-2 text-right text-muted font-normal">{{ t('bonus.tableScoreRange') }}</th>
                </tr>
                </thead>
                <tbody>
                <tr
                    v-for="res in results"
                    :key="res.bonus"
                    class="border-b border-border/60 hover:bg-surface/30 transition-colors"
                >
                    <td class="px-3 py-2 font-mono font-bold text-primary">
                        {{ res.bonus }}%
                    </td>
                    <td class="px-3 py-2 text-right font-mono">
                        <span class="text-text">{{ res.scoreRange.min.toLocaleString() }}</span>
                        <span class="mx-2 text-muted">-</span>
                        <span class="text-text">{{ res.scoreRange.max.toLocaleString() }}</span>
                    </td>
                </tr>
                <tr v-if="results.length === 0">
                    <td colspan="2" class="px-3 py-10 text-center text-muted">
                        {{ formData.targetPT > 0 ? t('bonus.noResult') : t('bonus.inputPrompt') }}
                    </td>
                </tr>
                </tbody>
            </table>
        </div>

        <div class="mt-1 text-[11px] leading-relaxed text-muted/80">
            <p>● <strong>{{ t('bonus.theoryTitle') }}</strong>：{{ t('bonus.theoryDesc') }}</p>
            <p>● <strong>{{ t('bonus.usageTitle') }}</strong>：{{ t('bonus.usageDesc') }}</p>
        </div>
    </div>
</template>