<script setup lang="ts">
import { computed } from "vue";
import { getEventBannerUrl } from "@/features/event/eventPresentation";
import { useI18n } from "@/i18n";
import type { EventOption } from "@/types/event";
import { formatDateTime } from "@/utils/time";

const props = defineProps<{
    event: EventOption | null | undefined;
    loading: boolean;
}>();

const { t } = useI18n();

const bannerUrl = computed(() => {
    if (!props.event) {
        return undefined;
    }

    return getEventBannerUrl(props.event.server, props.event.assetBundleName);
});

function toCamelCase<S extends string>(str: S): string {
    return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function eventType(type: string | null | undefined): string {
    const eventType = ["live_try", "mission_live", "challenge", "versus", "medley", "festival"];
    return typeof type === "string" && eventType.includes(type) ? `home.eventTypes.${toCamelCase(type)}` : (type ?? "home.eventUnknown");
}
</script>

<template>
    <section class="mb-2">
        <div v-if="props.event"
             class="flex flex-col-reverse items-center justify-between gap-6 md:flex-row md:items-stretch">
            <div class="flex min-w-0 flex-1 flex-col justify-center text-center">
                <h2 class="break-words text-2xl font-bold leading-tight text-text">
                    {{ props.event.eventName }}
                </h2>

                <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm text-muted">
                    <span>{{ t('home.eventType') }}：{{ t(eventType(props.event.eventType)) }}</span>
                    <span>{{ t('home.eventStart') }}：{{ formatDateTime(props.event.startAt) }}</span>
                    <span>{{ t('home.eventEnd') }}：{{ formatDateTime(props.event.endAt) }}</span>
                </div>
            </div>

            <div class="w-full md:flex-none md:basis-[33.333333%] md:max-w-[33.333333%]">
                <img
                    v-if="bannerUrl"
                    :src="bannerUrl"
                    :alt="props.event.eventName"
                    class="aspect-[3/1] w-full rounded-app object-cover"
                    loading="lazy"
                />
                <div v-else class="flex aspect-[3/1] w-full items-center justify-center rounded-app text-sm text-muted">
                    {{ props.loading ? t('home.eventLoading') : t('home.eventEmpty') }}
                </div>
            </div>
        </div>

        <div v-else class="flex flex-col-reverse items-center justify-between gap-6 md:flex-row md:items-stretch">
            <div class="flex min-w-0 flex-1 items-center justify-center text-sm text-muted md:justify-start">
                {{ props.loading ? t('home.eventLoading') : t('home.eventEmpty') }}
            </div>
            <div class="w-full md:flex-none md:basis-[33.333333%] md:max-w-[33.333333%]">
                <div class="flex aspect-[3/1] w-full items-center justify-center rounded-app text-sm text-muted">
                    {{ props.loading ? t('home.eventLoading') : t('home.eventEmpty') }}
                </div>
            </div>
        </div>
    </section>
</template>

