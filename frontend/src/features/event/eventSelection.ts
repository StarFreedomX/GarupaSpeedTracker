import type { EventListResponse, EventOption } from "@/types/event";
import type { ServerKey } from "@/types/score";
import { formatDateTime } from "@/utils/time";

const toNumber = (value: string | null | undefined): number | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const pickLocalizedName = (names: Array<string | null> | undefined, fallback: string, server: ServerKey): string => {
    const localized = names?.[server];
    if (localized?.trim()) {
        return localized;
    }

    const alt = names?.find((name): name is string => Boolean(name?.trim()));
    return alt ?? fallback;
};

const compareByProximity = (left: EventOption, right: EventOption, now: number): number => {
    const distanceDelta = Math.abs(left.startAt - now) - Math.abs(right.startAt - now);
    if (distanceDelta !== 0) {
        return distanceDelta;
    }

    const startDelta = right.startAt - left.startAt;
    if (startDelta !== 0) {
        return startDelta;
    }

    return left.eventId - right.eventId;
};

export const buildEventOptions = (payload: EventListResponse, server: ServerKey, now = Date.now()): EventOption[] => {
    return Object.entries(payload)
        .map(([eventId, raw]) => {
            const id = Number(eventId);
            const startAt = toNumber(raw.startAt?.[server]);
            const endAt = toNumber(raw.endAt?.[server]);

            if (!Number.isFinite(id) || startAt === undefined || endAt === undefined) {
                return undefined;
            }

            const eventName = pickLocalizedName(raw.eventName, `Event ${id}`, server);
            return {
                eventId: id,
                eventName,
                eventType: raw.eventType ?? null,
                assetBundleName: raw.assetBundleName ?? null,
                startAt,
                endAt,
                label: `${id} - ${eventName} (${formatDateTime(startAt)})`,
                server,
            } satisfies EventOption;
        })
        .filter((value): value is EventOption => value !== undefined)
        .sort((left, right) => compareByProximity(left, right, now));
};

export const selectBestEventId = (options: EventOption[], now = Date.now(), preferredEventId?: number): number | undefined => {
    if (preferredEventId !== undefined) {
        const preferred = options.find((option) => option.eventId === preferredEventId);
        if (preferred) {
            return preferred.eventId;
        }
    }

    const active = options.filter((option) => option.startAt <= now && now <= option.endAt);
    if (active.length > 0) {
        return active.sort((left, right) => compareByProximity(left, right, now))[0]?.eventId;
    }

    return options[0]?.eventId;
};
