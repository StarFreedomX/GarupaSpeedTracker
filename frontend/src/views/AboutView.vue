<script setup lang="ts">
import { useI18n } from "@/i18n";

const { t } = useI18n();
</script>

<template>
    <section class="app-panel max-w-3xl p-4 text-sm text-muted">
        <h2 class="mb-3 text-base font-semibold text-text">{{ t('about.title') }}</h2>
        <p class="leading-6">
            {{ t('about.desc') }}
        </p>
        <p class="mt-3 leading-6">
            {{ t('about.source') }}
        </p>
    </section>
</template>


