import { onBeforeUnmount, type Ref, watch } from "vue";

export interface ShiftWheelHorizontalScrollOptions {
    enabled?: () => boolean;
    lineHeight?: number;
    multiplier?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

const normalizeWheelDelta = (event: WheelEvent, lineHeight: number, pageSize: number): number => {
    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;

    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return delta * lineHeight;
    }

    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return delta * pageSize;
    }

    return delta;
};

export const useShiftWheelHorizontalScroll = (targetRef: Ref<HTMLElement | null>, options: ShiftWheelHorizontalScrollOptions = {}) => {
    const lineHeight = options.lineHeight ?? 16;
    const multiplier = options.multiplier ?? 1;
    let animationFrame = 0;

    const stopAnimation = () => {
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }
    };

    const animateScrollLeft = (element: HTMLElement, targetScrollLeft: number) => {
        stopAnimation();

        const startScrollLeft = element.scrollLeft;
        const distance = targetScrollLeft - startScrollLeft;

        if (distance === 0) {
            return;
        }

        const duration = Math.max(120, Math.min(320, Math.abs(distance) * 0.35));
        const startedAt = performance.now();

        const step = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / duration);
            const eased = 1 - (1 - progress) ** 3;

            element.scrollLeft = startScrollLeft + distance * eased;

            if (progress < 1) {
                animationFrame = requestAnimationFrame(step);
                return;
            }

            animationFrame = 0;
        };

        animationFrame = requestAnimationFrame(step);
    };

    const handleWheel = (event: WheelEvent) => {
        if (options.enabled && !options.enabled()) {
            return;
        }

        if (!event.shiftKey) {
            return;
        }

        const element = targetRef.value;
        if (!element) {
            return;
        }

        const maxScrollLeft = element.scrollWidth - element.clientWidth;
        if (maxScrollLeft <= 0) {
            return;
        }

        const delta = normalizeWheelDelta(event, lineHeight, element.clientWidth);
        if (delta === 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        const targetScrollLeft = clamp(element.scrollLeft + delta * multiplier, 0, maxScrollLeft);
        animateScrollLeft(element, targetScrollLeft);
    };

    watch(
        targetRef,
        (next, prev) => {
            prev?.removeEventListener("wheel", handleWheel, true);

            if (next) {
                next.addEventListener("wheel", handleWheel, { capture: true, passive: false });
            }
        },
        { immediate: true },
    );

    onBeforeUnmount(() => {
        targetRef.value?.removeEventListener("wheel", handleWheel, true);
        stopAnimation();
    });

    return {
        stopAnimation,
    };
};
