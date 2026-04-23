<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useAttrs, watch } from "vue";
import { TOOLTIP_DELAY_MS, TOOLTIP_MARGIN_PX, TOOLTIP_OFFSET_PX } from "@/config/config";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
    defineProps<{
        content: string;
        disabled?: boolean;
        offset?: number;
        delay?: number;
    }>(),
    {
        disabled: false,
        offset: TOOLTIP_OFFSET_PX,
        delay: TOOLTIP_DELAY_MS,
    },
);

const attrs = useAttrs();
const triggerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const panelStyle = ref({ left: "-9999px", top: "-9999px" });
let showTimer: number | undefined;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const removeListeners = (): void => {
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
};

async function reposition(): Promise<void> {
    await nextTick();

    const trigger = triggerRef.value;
    const panel = panelRef.value;
    if (!visible.value || !trigger || !panel) {
        return;
    }

    const rect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = TOOLTIP_MARGIN_PX;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(margin, viewportWidth - panelRect.width - margin);
    const maxTop = Math.max(margin, viewportHeight - panelRect.height - margin);

    let top = rect.top - panelRect.height - props.offset;
    let left = rect.left + rect.width / 2 - panelRect.width / 2;

    if (top < margin) {
        top = rect.bottom + props.offset;
    }

    top = clamp(top, margin, maxTop);
    left = clamp(left, margin, maxLeft);

    panelStyle.value = {
        left: `${left}px`,
        top: `${top}px`,
    };
}

const open = (): void => {
    if (props.disabled) {
        return;
    }

    if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
    }

    showTimer = window.setTimeout(() => {
        visible.value = true;
    }, props.delay);
};

const close = (): void => {
    if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
        showTimer = undefined;
    }

    visible.value = false;
};

watch(visible, async (next) => {
    if (next) {
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
        await reposition();
        return;
    }

    removeListeners();
});

watch(
    () => props.content,
    () => {
        if (visible.value) {
            void reposition();
        }
    },
);

onBeforeUnmount(() => {
    if (showTimer !== undefined) {
        window.clearTimeout(showTimer);
    }

    removeListeners();
});
</script>

<template>
    <span
        ref="triggerRef"
        v-bind="attrs"
        @mouseenter="open"
        @mouseleave="close"
        @focusin="open"
        @focusout="close"
    >
    <slot/>
    </span>

    <Teleport to="body">
        <div
            v-if="visible"
            ref="panelRef"
            :style="panelStyle"
            class="fixed z-[90] max-w-sm rounded-app border border-border/80 bg-surface/95 px-3 py-2 text-xs text-text shadow-lg backdrop-blur-sm pointer-events-none whitespace-pre-wrap"
        >
            {{ props.content }}
        </div>
    </Teleport>
</template>


