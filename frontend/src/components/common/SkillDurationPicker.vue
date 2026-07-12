<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
    modelValue: string;
}>();

const emit = defineEmits<(e: "update:modelValue", value: string) => void>();

const INTEGER_OPTIONS = [3, 4, 5, 6, 7, 8] as const;

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);

const parsed = computed(() => {
    const parts = props.modelValue.split(".");
    return {
        integer: Number.parseInt(parts[0] ?? "7", 10),
        decimal: Number.parseInt(parts[1] ?? "0", 10),
    };
});

// 面板内暂选的个位（点击小数位才确认）
const pendingInteger = ref(parsed.value.integer);

// 打开时同步 pendingInteger
const toggle = () => {
    if (!open.value) {
        pendingInteger.value = parsed.value.integer;
    }
    open.value = !open.value;
};

/** 每个整数对应的有效小数位（基于 skills/all.10.json 实际出现的时长） */
const VALID_DECIMALS: Record<number, number[]> = {
    3: [0, 5],
    4: [0, 5],
    5: [0, 5, 6, 7],
    6: [0, 2, 4, 5, 8],
    7: [0, 2, 5],
    8: [0],
};

const availableDecimals = computed(() => {
    return VALID_DECIMALS[pendingInteger.value] ?? [0];
});

const selectInteger = (int: number) => {
    pendingInteger.value = int;
};

const selectDecimal = (dec: number) => {
    emit("update:modelValue", `${pendingInteger.value}.${dec}`);
    open.value = false;
};

const closeOnClickOutside = (event: MouseEvent) => {
    if (triggerRef.value && !triggerRef.value.contains(event.target as Node)) {
        open.value = false;
    }
};

watch(open, (isOpen) => {
    if (isOpen) {
        document.addEventListener("click", closeOnClickOutside);
    } else {
        document.removeEventListener("click", closeOnClickOutside);
    }
});
</script>

<template>
    <div ref="triggerRef" class="relative">
        <!-- 触发器：外观类似原生 select -->
        <button
            type="button"
            class="flex w-full items-center justify-between rounded border border-border/80 bg-surface/90 px-2 py-1.5 text-sm text-text transition-colors hover:bg-surface"
            @click.stop="toggle"
        >
            <span>{{ modelValue }}</span>
            <span class="ml-1 text-xs text-muted transition-transform" :class="open ? 'rotate-180' : ''">▼</span>
        </button>

        <!-- 下拉面板 -->
        <div
            v-if="open"
            class="absolute left-0 z-50 mt-1 rounded border border-border/80 bg-surface/95 shadow-lg"
        >
            <div class="flex">
                <!-- 左栏：个位（点击仅高亮，不关闭） -->
                <div class="flex max-h-48 flex-col overflow-y-auto border-r border-border/60 py-1">
                    <button
                        v-for="int in INTEGER_OPTIONS"
                        :key="int"
                        type="button"
                        class="min-w-[2.5rem] px-4 py-1.5 text-left text-sm transition-colors hover:bg-primary/20"
                        :class="int === pendingInteger ? 'bg-primary/15 text-primary font-medium' : 'text-text'"
                        @click.stop="selectInteger(int)"
                    >
                        {{ int }}
                    </button>
                </div>
                <!-- 右栏：小数位（点击确认并关闭） -->
                <div class="flex max-h-48 flex-col overflow-y-auto py-1">
                    <button
                        v-for="dec in availableDecimals"
                        :key="dec"
                        type="button"
                        class="min-w-[2.5rem] px-4 py-1.5 text-left text-sm transition-colors"
                        :class="dec === parsed.decimal && pendingInteger === parsed.integer
                            ? 'bg-primary/15 text-primary font-medium'
                            : 'text-text hover:bg-primary/20'"
                        @click.stop="selectDecimal(dec)"
                    >
                        .{{ dec }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
