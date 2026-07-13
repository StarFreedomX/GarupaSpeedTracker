<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { calcEventPT } from "@/features/PT/calcSinglePT";
import type { FpsOption } from "@/features/songMeta/autoScoreMath";
import { calcExactScoreInTurns } from "@/features/songMeta/autoScoreMath";
import { useI18n } from "@/i18n";
import type { Skill, SongLevelSummary } from "@/types/songMetadata";
import DraggableSkillList from "./DraggableSkillList.vue";

const { t } = useI18n();

export type ActivityType = "mission" | "try" | "challenge" | "versus" | "5v5" | "medley1";

const props = defineProps<{
    visible: boolean;
    songId: number;
    songName: string;
    difficulty: string;
    songLevelSummary: SongLevelSummary;
    minAutoScore: number;
    maxAutoScore: number;
    skills: Skill[];
    centerIndex: number;
    totalPower: number;
    autoPara: number;
    activityType: ActivityType;
    supportBandPower: number;
    eventBonus: number;
    fps: FpsOption;
}>();

const emit = defineEmits<(e: "close") => void>();

const difficultyLabel: Record<string, string> = {
    "0": "Easy",
    "1": "Normal",
    "2": "Hard",
    "3": "Expert",
    "4": "Special",
};

// ── Skill order state ──
const skillOrder = ref<number[]>([0, 1, 2, 3, 4]);

// Reset order when modal opens for a new song
watch(
    () => props.visible,
    (val) => {
        if (val) {
            skillOrder.value = [0, 1, 2, 3, 4];
        }
    },
);

// ── Computed score ──
// The center skill (captain) is always the 6th fixed trigger (position 5).
// Derived from skills[centerIndex] for absolute consistency — never trust a separate prop.
const orderedSkills = computed<Skill[]>(() => {
    const center = props.skills[props.centerIndex];
    const ordered: Skill[] = [];
    for (const idx of skillOrder.value) {
        ordered.push(props.skills[idx]);
    }
    ordered.push(center); // center always at position 5 (6th trigger)
    return ordered;
});

const calcError = ref("");

const exactScore = computed(() => {
    try {
        calcError.value = "";
        return calcExactScoreInTurns(props.totalPower, orderedSkills.value, props.songLevelSummary, props.autoPara, props.fps);
    } catch (err) {
        calcError.value = t("auto.detail.error");
        console.error("Exact score calc error:", err);
        return 0;
    }
});

const exactPT = computed(() => {
    try {
        if (calcError.value) return 0;
        const score = exactScore.value;
        switch (props.activityType) {
            case "mission":
                return calcEventPT(score, {
                    type: "mission",
                    supportBandPower: props.supportBandPower,
                    eventBonus: props.eventBonus,
                });
            case "try":
                return calcEventPT(score, {
                    type: "try",
                    eventBonus: props.eventBonus,
                });
            case "challenge":
                return calcEventPT(score, {
                    type: "challenge",
                    eventBonus: props.eventBonus,
                });
            case "versus":
                return calcEventPT(score, { type: "versus" });
            case "5v5":
                return calcEventPT(score, { type: "5v5" });
            case "medley1":
                return calcEventPT(score, { type: "medley1" });
            default:
                return 0;
        }
    } catch (err) {
        console.error("PT calc error:", err);
        return 0;
    }
});

// ── ESC key & body scroll lock ──
function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && props.visible) {
        emit("close");
    }
}

watch(
    () => props.visible,
    (val) => {
        if (val) {
            document.addEventListener("keydown", onKeydown);
            document.body.style.overflow = "hidden";
        } else {
            document.removeEventListener("keydown", onKeydown);
            document.body.style.overflow = "";
        }
    },
    { immediate: true },
);

onBeforeUnmount(() => {
    document.removeEventListener("keydown", onKeydown);
    document.body.style.overflow = "";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-[80] flex items-center justify-center p-4"
        @click.self="emit('close')"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40" />

        <!-- Panel -->
        <div
          class="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded border border-border/80 bg-surface shadow-xl"
        >
          <!-- Header -->
          <div
            class="flex shrink-0 items-center justify-between border-b border-border/80 px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <span class="text-sm font-medium text-text truncate">{{ songName }}</span>
              <span class="ml-2 text-xs text-muted">
                {{ difficultyLabel[difficulty] ?? difficulty }}
              </span>
              <span class="ml-2 text-xs text-muted/70">ID: {{ songId }}</span>
            </div>
            <button
              type="button"
              class="app-btn ml-3 shrink-0 rounded border border-border/80 px-2.5 py-1 text-sm text-muted transition-colors hover:text-text hover:bg-surface/80"
              @click="emit('close')"
            >
              ✕
            </button>
          </div>

          <!-- Body -->
          <div class="flex flex-col gap-4 overflow-auto p-4 md:flex-row">
            <!-- Left: draggable skill list -->
            <div class="flex-1 min-w-0">
              <h3 class="mb-2 text-xs font-medium text-muted">
                {{ t('auto.detail.skillOrder') }}
              </h3>
              <DraggableSkillList
                :skills="skills"
                :skill-order="skillOrder"
                :center-index="centerIndex"
                @update:skill-order="skillOrder = $event"
              />
            </div>

            <!-- Right: result display -->
            <div class="w-full md:w-56 md:shrink-0">
              <h3 class="mb-2 text-xs font-medium text-muted">
                {{ t('auto.detail.result') }}
              </h3>
              <div class="rounded border border-border/80 bg-surface/50 p-3">
                <div v-if="calcError" class="text-xs text-red-500">
                  {{ calcError }}
                </div>
                <template v-else>
                  <div class="mb-3">
                    <span class="text-xs text-muted">{{ t('auto.detail.exactScore') }}</span>
                    <div class="mt-0.5 text-lg font-mono font-bold text-primary tabular-nums">
                      {{ exactScore.toLocaleString() }}
                    </div>
                  </div>
                  <div class="mb-3">
                    <span class="text-xs text-muted">{{ t('auto.detail.exactPT') }}</span>
                    <div class="mt-0.5 text-lg font-mono font-bold text-text tabular-nums">
                      {{ exactPT.toLocaleString() }}
                    </div>
                  </div>
                  <div class="border-t border-border/60 pt-2 text-[10px] leading-relaxed text-muted/80">
                    {{ t('auto.detail.rangeNote', { min: minAutoScore.toLocaleString(), max: maxAutoScore.toLocaleString() }) }}
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.modal-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.modal-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
