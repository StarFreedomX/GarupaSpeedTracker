import type { BestdoriPointRaw } from "@/types/bestdori";

/** Convert epoch value to milliseconds (supports second-level timestamps). */
export const toMs = (timestamp: number): number => (timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp);

/** Group points by timestamp for anomaly filtering and alignment. */
export const groupPointsByTime = (points: BestdoriPointRaw[]): Map<number, BestdoriPointRaw[]> => {
    const grouped = new Map<number, BestdoriPointRaw[]>();

    for (const point of points) {
        const list = grouped.get(point.time) ?? [];
        list.push(point);
        grouped.set(point.time, list);
    }

    return grouped;
};
