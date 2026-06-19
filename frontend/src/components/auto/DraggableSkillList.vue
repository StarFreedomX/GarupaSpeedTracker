<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "@/i18n";
import type { Skill } from "@/types/songMetadata";

const { t } = useI18n();

const props = defineProps<{
    skills: Skill[];
    skillOrder: number[];
    centerIndex: number;
}>();

const emit = defineEmits<(e: "update:skillOrder", order: number[]) => void>();

// ── Drag state ──
// Key principle: keep the array order FIXED during drag.
// All visual movement comes from CSS transforms only.
// Commit the final order ONCE on pointerup.

interface DragState {
    pointerId: number;
    draggedIdx: number; // original position in the displayed list (0-4)
    startY: number;
    itemHeight: number;
}
const drag = ref<DragState | null>(null);
const pointerY = ref(0);

// ── Computed: current visual target slot for the dragged item ──
const targetSlot = computed(() => {
    if (!drag.value) return -1;
    const raw = drag.value.draggedIdx + Math.round((pointerY.value - drag.value.startY) / drag.value.itemHeight);
    return Math.max(0, Math.min(4, raw));
});

// ── Shift map: skillIdx → translateY offset for non-dragged items that need to make room ──
const shifts = ref<Record<number, number>>({});

function updateShifts(draggedIdx: number, target: number) {
    const map: Record<number, number> = {};
    if (target === draggedIdx) {
        shifts.value = map;
        return;
    }
    const h = drag.value?.itemHeight ?? 0;
    for (let i = 0; i < props.skillOrder.length; i++) {
        const skillIdx = props.skillOrder[i];
        if (i === draggedIdx) continue;
        if (draggedIdx < target) {
            // dragging downward: items between (draggedIdx, target] shift UP
            if (i > draggedIdx && i <= target) {
                map[skillIdx] = -h;
            }
        } else {
            // dragging upward: items between [target, draggedIdx) shift DOWN
            if (i >= target && i < draggedIdx) {
                map[skillIdx] = h;
            }
        }
    }
    shifts.value = map;
}

// ── Pointer handlers ──
function onPointerDown(e: PointerEvent, displayIdx: number) {
    if (drag.value) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    // Measure the actual item height from the element
    const rect = el.getBoundingClientRect();
    const gap = 8; // matches gap-2 in the flex container
    const itemH = rect.height + gap;

    drag.value = {
        pointerId: e.pointerId,
        draggedIdx: displayIdx,
        startY: e.clientY,
        itemHeight: itemH,
    };
    pointerY.value = e.clientY;

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    document.body.style.touchAction = "none";
}

function onPointerMove(e: PointerEvent) {
    if (!drag.value) return;
    pointerY.value = e.clientY;

    updateShifts(drag.value.draggedIdx, targetSlot.value);
}

function onPointerUp(_e: PointerEvent) {
    if (!drag.value) return;
    const finalTarget = targetSlot.value;
    const orig = drag.value.draggedIdx;

    // Commit the order change
    if (finalTarget !== orig) {
        const newOrder = [...props.skillOrder];
        const [moved] = newOrder.splice(orig, 1);
        newOrder.splice(finalTarget, 0, moved);
        emit("update:skillOrder", newOrder);
    }

    // Clean up
    drag.value = null;
    pointerY.value = 0;
    shifts.value = {};

    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    document.body.style.touchAction = "";
}

// ── Style helper for each item ──
function getItemStyle(skillIdx: number, displayIdx: number) {
    if (!drag.value) return undefined;

    const d = drag.value;
    const isDragged = displayIdx === d.draggedIdx;

    if (isDragged) {
        const deltaY = pointerY.value - d.startY;
        return {
            transform: `translateY(${deltaY}px)`,
            zIndex: 20,
            position: "relative" as const,
            transition: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        };
    }

    const shift = shifts.value[skillIdx];
    if (shift !== undefined && shift !== 0) {
        return {
            transform: `translateY(${shift}px)`,
            transition: "transform 0.2s ease",
            position: "relative" as const,
        };
    }

    return {
        transform: "translateY(0px)",
        transition: "transform 0.2s ease",
        position: "relative" as const,
    };
}

function getItemClass(displayIdx: number) {
    if (!drag.value) return "cursor-grab";
    if (displayIdx === drag.value.draggedIdx) return "cursor-grabbing";
    return "cursor-grab";
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <p class="text-xs text-muted">{{ t('auto.detail.dragHint') }}</p>
    <div class="flex flex-col gap-2">
      <div
        v-for="(skillIdx, displayIdx) in skillOrder"
        :key="skillIdx"
        class="skill-block flex items-center gap-2 rounded border border-border/80 bg-surface/50 p-2.5 select-none"
        :class="[
          getItemClass(displayIdx),
          drag && drag.draggedIdx === displayIdx ? 'shadow-lg ring-1 ring-primary/40' : '',
        ]"
        :style="getItemStyle(skillIdx, displayIdx)"
        @pointerdown.prevent="onPointerDown($event, displayIdx)"
      >
        <!-- Order badge -->
        <span
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-medium"
          :class="skillIdx === centerIndex
            ? 'bg-primary/20 text-primary'
            : 'bg-muted/15 text-muted'"
        >
          {{ displayIdx + 1 }}
        </span>

        <!-- Duration -->
        <span class="w-10 shrink-0 text-xs text-text">{{ skills[skillIdx].duration }}s</span>

        <!-- ScoreUp multiplier -->
        <span class="w-16 shrink-0 text-right text-xs font-mono text-text">
          x{{ (skills[skillIdx].scoreUp * 100).toFixed(0) }}%
        </span>

        <!-- Progressive badge -->
        <span
          v-if="skills[skillIdx].progressive"
          class="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
        >
          P {{ (skills[skillIdx].progressive!.stepRate * 100).toFixed(1) }}%/{{ (skills[skillIdx].progressive!.maxCap * 100).toFixed(0) }}%
        </span>

        <!-- Center badge -->
        <span
          v-if="skillIdx === centerIndex"
          class="ml-auto shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          {{ t('auto.detail.center') }}
        </span>

        <!-- Drag handle -->
        <span class="ml-auto shrink-0 text-xs text-muted/40">
          ⠿
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skill-block {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  will-change: transform;
}
</style>
