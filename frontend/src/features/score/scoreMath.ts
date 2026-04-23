import type { PlayerTrack, ScorePoint, TableCell, TableModel, TableRow } from "@/types/score";
import { formatHm, toMs } from "@/utils/time";

/**
 * 收集所有玩家轨迹中的时间点并按升序排序。
 *
 * @param players 玩家轨迹列表。
 * @returns 排序后的时间点数组。
 */
function getSortedTimesAsc(players: PlayerTrack[]): number[] {
    const times = new Set<number>();
    for (const player of players) {
        for (const point of player.points) {
            times.add(point.time);
        }
    }

    return Array.from(times).sort((a, b) => toMs(a) - toMs(b));
}

/**
 * 获取玩家轨迹中最后一个有效积分。
 *
 * @param points 按时间排列的积分点列表。
 * @returns 最后一个有效积分；没有则返回 `-1`。
 */
function lastRecordedPoints(points: ScorePoint[]): number {
    return points.findLast((p) => p.points !== -1)?.points ?? -1;
}

/**
 * 按最新积分对玩家轨迹排序。
 *
 * @param players 待排序的玩家轨迹列表。
 * @returns 排序后的玩家轨迹列表。
 */
function sortPlayersByRank(players: PlayerTrack[]): PlayerTrack[] {
    return players
        .map((player) => ({
            player,
            lastPoints: lastRecordedPoints(player.points),
        }))
        .sort((a, b) => {
            const delta = b.lastPoints - a.lastPoints;
            if (delta !== 0) return delta;
            return a.player.uid - b.player.uid;
        })
        .map((item) => item.player);
}

/**
 * 生成表格单元格。
 *
 * @param value 当前时间点的积分值。
 * @param prevValue 前一个时间点的积分值。
 * @param fallbackValue 更早的可用积分值。
 * @returns 表格单元格对象。
 */
function createCell(value: number, prevValue: number, fallbackValue: number): TableCell {
    if (value === -1) {
        return { display: "-", points: value };
    }

    if (prevValue !== -1) {
        return { display: String(value - prevValue), points: value };
    }

    if (fallbackValue !== -1) {
        return { display: `(${value - fallbackValue})`, points: value };
    }

    return { display: "0", points: value };
}

/**
 * 为单个玩家生成按时间轴排列的单元格映射。
 *
 * @param timeline 全局时间轴。
 * @param player 单个玩家轨迹。
 * @returns 以时间戳为键的单元格映射。
 */
function buildCells(timeline: number[], player: PlayerTrack): Record<number, TableCell> {
    const valueByTime = new Map<number, number>();
    for (const point of player.points) {
        valueByTime.set(point.time, point.points);
    }

    const result: Record<number, TableCell> = {};

    for (let index = 0; index < timeline.length; index += 1) {
        const time = timeline[index];
        const current = valueByTime.get(time) ?? -1;

        let prev = -1;
        if (index > 0) {
            prev = valueByTime.get(timeline[index - 1]) ?? -1;
        }

        let fallback = -1;
        if (prev === -1) {
            for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                const probe = valueByTime.get(timeline[cursor]) ?? -1;
                if (probe !== -1) {
                    fallback = probe;
                    break;
                }
            }
        }

        result[time] = createCell(current, prev, fallback);
    }

    return result;
}

/**
 * 将玩家轨迹转换为表格模型。
 *
 * @param tracks 原始玩家轨迹列表。
 * @returns 表格渲染所需的模型对象。
 */
export function toTableModel(tracks: PlayerTrack[]): TableModel {
    const players = sortPlayersByRank(tracks);
    const timelineAsc = getSortedTimesAsc(players);

    const cellsByUid = new Map<number, Record<number, TableCell>>();
    for (const player of players) {
        cellsByUid.set(player.uid, buildCells(timelineAsc, player));
    }

    const rows: TableRow[] = [...timelineAsc].reverse().map((time) => ({
        time,
        label: formatHm(toMs(time)),
        cells: players.reduce<Record<number, TableCell>>((acc, player) => {
            acc[player.uid] = cellsByUid.get(player.uid)?.[time] ?? { display: "-", points: -1 };
            return acc;
        }, {}),
    }));

    return {
        players,
        rows,
    };
}

/**
 * 合并两批玩家轨迹数据。
 *
 * @param current 当前已有的玩家轨迹列表。
 * @param incoming 新接收到的玩家轨迹列表。
 * @returns 合并后的玩家轨迹列表。
 */
export function mergeTracks(current: PlayerTrack[], incoming: PlayerTrack[]): PlayerTrack[] {
    const merged = new Map<number, { info: PlayerTrack["info"]; points: Map<number, number> }>();

    const inject = (list: PlayerTrack[]) => {
        for (const player of list) {
            const previous = merged.get(player.uid) ?? {
                info: player.info,
                points: new Map<number, number>(),
            };

            previous.info = player.info;
            for (const point of player.points) {
                previous.points.set(point.time, point.points);
            }

            merged.set(player.uid, previous);
        }
    };

    inject(current);
    inject(incoming);

    return Array.from(merged.entries()).map(([uid, payload]) => ({
        uid,
        info: payload.info,
        points: Array.from(payload.points.entries())
            .map(([time, points]) => ({ time, points }))
            .sort((a, b) => toMs(a.time) - toMs(b.time)),
    }));
}

/**
 * 获取最近时间戳列表中的首个值。
 *
 * @param tracks 玩家轨迹列表。
 * @returns 最近时间戳中的首个值；没有则返回当前时间。
 */
export const latestTimestamp = (tracks: PlayerTrack[]): number => {
    return getLatestTimeStamps(tracks).at(0) || Date.now();
};

/**
 * 提取一组最近时间戳。
 *
 * @param tracks 玩家轨迹列表。
 * @returns 最近时间戳数组。
 */
export function getLatestTimeStamps(tracks: PlayerTrack[]): number[] {
    const latest: number[] = [];
    for (const player of tracks) {
        for (const point of [...player.points].reverse()) {
            if (latest.length < 20) {
                latest.push(point.time);
            } else {
                break;
            }
        }
        if (latest.length) break;
    }
    return latest;
}

/**
 * 计算最近时间戳的典型间隔。
 *
 * @param latestTimeStamps 最近时间戳数组。
 * @returns 典型时间间隔；不足 2 个时间戳时返回 `0`。
 */
export function calculateTolerance(latestTimeStamps: number[]): number {
    const n = latestTimeStamps.length;
    // latestTimeStamps = latestTimeStamps.sort()

    if (n < 2) return 0;

    // 计算所有相邻差值
    const diffs: number[] = [];
    for (let i = 0; i < n - 1; i++) {
        diffs.push(latestTimeStamps[i] - latestTimeStamps[i + 1]);
    }

    // 排序以获取中位数
    diffs.sort((a, b) => a - b);

    const mid = Math.floor(diffs.length / 2);

    // 返回中位数作为公差
    if (diffs.length % 2 !== 0) {
        return diffs[mid];
    }
    return (diffs[mid - 1] + diffs[mid]) / 2;
}
