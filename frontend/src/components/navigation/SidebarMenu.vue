<script setup lang="ts">
interface MenuItem {
    key: string;
    label: string;
}

defineProps<{
    items: MenuItem[];
    active: string;
    expanded: boolean;
}>();

const emit = defineEmits<(event: "select", key: string) => void>();
</script>

<template>
    <aside
        class="app-panel fixed left-0 top-0 z-40 h-full w-52 overflow-hidden transform transition-transform duration-300"
        :class="expanded ? 'translate-x-0' : '-translate-x-full'"
    >
        <div class="flex flex-col gap-2 p-3">
            <button
                v-for="item in items"
                :key="item.key"
                type="button"
                class="relative flex items-center overflow-hidden rounded-app border px-3 py-2.5 text-left text-sm transition-all duration-200"
                :class="active === item.key
                    ? 'border-primary/25 bg-primary/14 text-text shadow-sm shadow-primary/10 translate-x-0.5'
                    : 'border-transparent text-muted hover:border-border hover:bg-surface/70 hover:text-text'"
                :aria-current="active === item.key ? 'page' : undefined"
                @click="emit('select', item.key)"
            >
        <span
            v-if="active === item.key"
            class="absolute inset-y-1 left-1 w-1 rounded-full bg-primary"
        />
                <span>{{ item.label }}</span>
            </button>
        </div>
    </aside>
</template>


