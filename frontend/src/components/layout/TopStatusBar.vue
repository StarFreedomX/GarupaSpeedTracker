<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
    status: string;
    lastUpdated: number | null;
}>();

const { t } = useI18n();

const updatedLabel = computed(() => {
    if (!props.lastUpdated) {
        return t("topbar.notSynced");
    }

    return new Date(props.lastUpdated).toLocaleTimeString();
});
</script>

<template>
    <header class="topbar-rect flex items-center justify-between gap-3 px-3 py-2">
        <div class="flex items-center gap-3 pl-12">
            <div class="flex flex-col">
                <span class="text-sm font-semibold leading-5">{{ t('topbar.title') }}</span>
                <span class="text-xs text-muted leading-4">{{ t('topbar.status') }}: {{
                        status
                    }} | {{ t('topbar.lastUpdate') }}: {{ updatedLabel }}</span>
            </div>
        </div>
    </header>
</template>


