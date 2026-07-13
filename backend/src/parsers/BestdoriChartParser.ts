import type { Chart, ChartItem, ConnectionNote } from "@/types/bestdori/chart";
import type { SkillDuration, SongLevelSummary } from "@/types/songMetadata";

/** 基于 skills/all.10.json 的实际技能时长，共 17 个 */
const SKILL_DURATIONS: SkillDuration[] = [
    "3.0",
    "3.5",
    "4.0",
    "4.5",
    "5.0",
    "5.5",
    "5.6",
    "5.7",
    "6.0",
    "6.2",
    "6.4",
    "6.5",
    "6.8",
    "7.0",
    "7.2",
    "7.5",
    "8.0",
];
const DEFAULT_BPM = 120;
const TARGET_SKILL_COUNT = 6;
const FPS_EPSILON = 1e-9;
/** 4-bit binary: smmm/16. s=sign, mmm=magnitude(0-7). All fractions are powers of 2 → IEEE 754 exact. */
const ENCODE_DENOM = 16;
/** 最大排队延迟帧数 = ceil(8.0*fps-ε)+1(end) + ceil(0.75*fps)(finishing decrement) + 1(transition) + 1(trigger) */
const MAX_FRAME_EXTENSION = Math.ceil(8.0 * 60 - FPS_EPSILON) + 1 + Math.ceil(0.75 * 60) + 1 + 1;

type BeatEvent = {
    beat: number;
    seconds: number;
};

type BpmPoint = [number, number];

interface NormalizedChart {
    total: number;
    noteEvents: BeatEvent[];
    skillEvents: BeatEvent[];
}

/**
 * 将 Bestdori chart 原始数据归一化为 songMetadata 定义的 SongSummary。
 */
export class BestdoriChartParser {
    public buildLevelSummary(chart: Chart, level: number): SongLevelSummary {
        const normalized = this.normalizeChart(chart);
        const counts = this.buildCounts(normalized);
        const overlaps = this.computeOverlaps(normalized);

        return {
            level,
            total: normalized.total,
            counts,
            ...(overlaps && { overlaps }),
        };
    }

    private normalizeChart(chart: Chart): NormalizedChart {
        const bpmTimeline = this.buildBpmTimeline(this.extractBpmList(chart));
        let skillEvents = chart.flatMap((item) => this.extractSkillEvents(item, bpmTimeline)).sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);

        // Treat skill triggers that happen at the same beat/time as a single trigger.
        // Some charts (e.g. special tracks) may contain multiple skill flags at the same beat
        // (big-keys / multi-lane skills). Collapse those into one skill event to match
        // in-game behavior where simultaneous skill taps count as one activation.
        const deduped: BeatEvent[] = [];
        const EPS = 1e-6;
        for (const se of skillEvents) {
            if (deduped.length === 0) {
                deduped.push(se);
                continue;
            }

            const prev = deduped[deduped.length - 1];
            if (Math.abs(prev.beat - se.beat) <= EPS) {
                // same beat/time -> ignore additional skill points
                continue;
            }

            deduped.push(se);
        }

        skillEvents = deduped;
        const noteEvents = chart.flatMap((item) => this.extractNoteEvents(item, bpmTimeline)).sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);

        return {
            total: skillEvents.length + noteEvents.length,
            noteEvents,
            skillEvents,
        };
    }

    private extractBpmList(chart: Chart): BpmPoint[] {
        return chart
            .filter((item): item is Extract<ChartItem, { type: "BPM" }> => item.type === "BPM")
            .slice()
            .sort((a, b) => a.beat - b.beat || a.bpm - b.bpm)
            .map((event) => [event.beat, event.bpm] as BpmPoint);
    }

    /**
     * 帧计数模型：技能窗口 = ceil(duration*fps) 次递减 + 1 帧结束帧。
     *
     * 输出编码: base + v/16，v 是 4-bit smmm:
     *   s=符号位(0=+, 1=-), mmm=|60fps-120fps|(0-7)
     * 例如 5.125 = 5 + 2/16 → 120fps=5, diff=+2, 60fps=7.
     */
    private buildCounts(normalized: NormalizedChart): Record<SkillDuration, number[]> {
        const skillEvents = normalized.skillEvents.slice();

        if (skillEvents.length !== TARGET_SKILL_COUNT) {
            throw new Error(`Expected ${TARGET_SKILL_COUNT} skill events, but parsed ${skillEvents.length}.`);
        }

        const counts = {} as Record<SkillDuration, number[]>;

        for (const duration of SKILL_DURATIONS) {
            const durSec = Number(duration);
            counts[duration] = skillEvents.map((skillEvent) => {
                const c120 = this.countNotesInWindow(normalized.noteEvents, skillEvent.seconds, durSec, 120);
                const c60 = this.countNotesInWindow(normalized.noteEvents, skillEvent.seconds, durSec, 60);
                return this.encodeCount(c120, c60 - c120);
            });
        }

        return counts;
    }

    /**
     * 计算技能排队偏移修正表。
     *
     * 当两个连续技能触发点的帧间隔 < MAX_FRAME_EXTENSION 时，前技能可能导致后技能排队。
     * 对每个可能排队的 position 和每对 (d_prev, d_cur) 组合，计算：
     *   delta = actualCount(排队窗口) - baselineCount(触发时刻窗口)
     *
     * 帧模型精确计算：prevEnd 和 GAP 全部 ceil(×fps) 量化到帧号。
     * 仅返回 delta ≠ 0 的项，无排队则返回 undefined。
     */
    private computeOverlaps(normalized: NormalizedChart): Record<number, Record<string, Record<string, number>>> | undefined {
        const skillEvents = normalized.skillEvents;
        const noteEvents = normalized.noteEvents;

        const overlaps: Record<number, Record<string, Record<string, number>>> = {};

        for (let i = 1; i < skillEvents.length; i++) {
            // 用 60fps 帧间隔做快速预检：间隔够大则任何 duration 都不会排队
            const FsPrev = Math.ceil(skillEvents[i - 1].seconds * 60);
            const FsCur = Math.ceil(skillEvents[i].seconds * 60);
            if (FsCur - FsPrev >= MAX_FRAME_EXTENSION) continue;

            const shifts = this.computePositionShifts(noteEvents, skillEvents[i - 1].seconds, skillEvents[i].seconds);
            if (Object.keys(shifts).length > 0) {
                overlaps[i] = shifts;
            }
        }

        return Object.keys(overlaps).length > 0 ? overlaps : undefined;
    }

    /**
     * 帧模型精确版：对指定 position 计算 shifts 二维表。
     * shifts[d_prev][d_cur] = encodeCount(delta120, delta60 - delta120)
     * 复用 counts 的 4-bit 编码，同时存 60fps 和 120fps 的偏移量。
     */
    private computePositionShifts(noteEvents: BeatEvent[], triggerPrev: number, triggerCur: number): Record<string, Record<string, number>> {
        const shifts: Record<string, Record<string, number>> = {};

        for (const dPrev of SKILL_DURATIONS) {
            const durPrev = Number(dPrev);

            // 60fps 排队窗口
            const Fs60Prev = Math.ceil(triggerPrev * 60);
            const cov60 = Math.ceil(durPrev * 60 - FPS_EPSILON) + 1;
            const gap60 = Math.ceil(0.75 * 60) + 1 + 1;
            const Fs60Bonus = Fs60Prev + cov60 + gap60;
            const Fs60Cur = Math.max(Math.ceil(triggerCur * 60), Fs60Bonus);
            const delayed60 = Fs60Cur / 60;

            // 120fps 排队窗口
            const Fs120Prev = Math.ceil(triggerPrev * 120);
            const cov120 = Math.ceil(durPrev * 120 - FPS_EPSILON) + 1;
            const gap120 = Math.ceil(0.75 * 120) + 1 + 1;
            const Fs120Bonus = Fs120Prev + cov120 + gap120;
            const Fs120Cur = Math.max(Math.ceil(triggerCur * 120), Fs120Bonus);
            const delayed120 = Fs120Cur / 120;

            // 都没延迟则跳过
            if (Fs60Cur === Math.ceil(triggerCur * 60) && Fs120Cur === Math.ceil(triggerCur * 120)) {
                continue;
            }

            const shiftsForPrev: Record<string, number> = {};

            for (const dCur of SKILL_DURATIONS) {
                const durCur = Number(dCur);
                const bl60 = this.countNotesInWindow(noteEvents, triggerCur, durCur, 60);
                const ac60 = this.countNotesInWindow(noteEvents, delayed60, durCur, 60);
                const bl120 = this.countNotesInWindow(noteEvents, triggerCur, durCur, 120);
                const ac120 = this.countNotesInWindow(noteEvents, delayed120, durCur, 120);

                const delta60 = ac60 - bl60;
                const delta120 = ac120 - bl120;

                if (delta60 !== 0 || delta120 !== 0) {
                    shiftsForPrev[dCur] = this.encodeCount(delta120, delta60 - delta120);
                }
            }

            if (Object.keys(shiftsForPrev).length > 0) {
                shifts[dPrev] = shiftsForPrev;
            }
        }

        return shifts;
    }

    /**
     * 帧计数: note 受加成 ⇔ ceil(noteTime*fps) ∈ (ceil(skillStartTime*fps), ceil(skillStartTime*fps) + ceil(dur*fps) + 1]
     * 也就是，note 受加成 ⇔  note所处的帧位置    ∈ (技能开始的帧位置, 技能开始的帧位置 + 技能时长导致的递减帧数 + 结束帧]
     */
    private countNotesInWindow(noteEvents: BeatEvent[], skillStartTime: number, durationSec: number, fps: number): number {
        const Fs = Math.ceil(skillStartTime * fps);
        const Fe = Fs + Math.ceil(durationSec * fps - FPS_EPSILON) + 1;

        let count = 0;
        for (const note of noteEvents) {
            if (note.seconds <= skillStartTime) continue;
            const Fn = Math.ceil(note.seconds * fps);
            if (Fn > Fs && Fn <= Fe) count++;
            else if (Fn > Fe) break; // noteEvents are time-sorted; remaining notes are beyond the window
        }
        return count;
    }

    /**
     * 4-bit binary encoding: base + (smmm)/16.
     * s=sign(0=+,1=-), mmm=magnitude(0-7).
     */
    private encodeCount(base: number, diff: number): number {
        if (diff === 0) return base; // clean integer
        const signBit = diff > 0 ? 0 : 1;
        const magnitude = Math.abs(diff);
        const binaryValue = (signBit << 3) | magnitude;
        return Math.round((base + binaryValue / ENCODE_DENOM) * 10000) / 10000;
    }

    private buildBpmTimeline(bpmList: BpmPoint[]): Array<{ beat: number; bpm: number; seconds: number }> {
        const sorted = bpmList.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (sorted.length === 0) {
            return [{ beat: 0, bpm: DEFAULT_BPM, seconds: 0 }];
        }

        const timeline: Array<{ beat: number; bpm: number; seconds: number }> = [];
        let currentSeconds = 0;
        let currentBeat = sorted[0][0];
        let currentBpm = sorted[0][1] > 0 ? sorted[0][1] : DEFAULT_BPM;

        timeline.push({ beat: currentBeat, bpm: currentBpm, seconds: currentSeconds });

        for (let index = 1; index < sorted.length; index += 1) {
            const [nextBeatRaw, nextBpmRaw] = sorted[index];
            const nextBeat = nextBeatRaw;
            const nextBpm = nextBpmRaw > 0 ? nextBpmRaw : DEFAULT_BPM;
            currentSeconds += ((nextBeat - currentBeat) * 60) / currentBpm;
            currentBeat = nextBeat;
            currentBpm = nextBpm;
            timeline.push({ beat: currentBeat, bpm: currentBpm, seconds: currentSeconds });
        }

        if (timeline[0].beat > 0) {
            const first = timeline[0];
            timeline.unshift({ beat: 0, bpm: first.bpm, seconds: 0 });
        }

        return timeline;
    }

    private beatToSeconds(beat: number, timeline: Array<{ beat: number; bpm: number; seconds: number }>): number {
        let selected = timeline[0];

        for (const point of timeline) {
            if (point.beat <= beat) {
                selected = point;
                continue;
            }

            break;
        }

        return selected.seconds + ((beat - selected.beat) * 60) / selected.bpm;
    }

    private extractSkillEvents(item: ChartItem, timeline: Array<{ beat: number; bpm: number; seconds: number }>): BeatEvent[] {
        // Skills can be triggered by different item types:
        // - Single items with `skill: true`
        // - Connection points inside Long/Slide items that have `skill: true` on the connection
        // Collect all skill trigger points we can find.
        if (item.type === "Single") {
            return item.skill ? [{ beat: item.beat, seconds: this.beatToSeconds(item.beat, timeline) }] : [];
        }

        if (item.type === "Long" || item.type === "Slide") {
            const points = (item as ConnectionNote).connections || [];
            return points.filter((p) => p.skill).map((p) => ({ beat: p.beat, seconds: this.beatToSeconds(p.beat, timeline) }));
        }

        return [];
    }

    private extractNoteEvents(item: ChartItem, timeline: Array<{ beat: number; bpm: number; seconds: number }>): BeatEvent[] {
        switch (item.type) {
            case "Single":
                return item.skill ? [] : [{ beat: item.beat, seconds: this.beatToSeconds(item.beat, timeline) }];
            case "Directional":
                return [{ beat: item.beat, seconds: this.beatToSeconds(item.beat, timeline) }];
            case "Long":
            case "Slide":
                return this.extractConnectionNotes(item, timeline);
            default:
                return [];
        }
    }

    private extractConnectionNotes(item: ConnectionNote, timeline: Array<{ beat: number; bpm: number; seconds: number }>): BeatEvent[] {
        // Exclude hidden connection points and also exclude connection points that are skill triggers
        // (they should be reported via extractSkillEvents instead of being considered normal notes).
        return item.connections
            .filter((point) => !point.hidden && !point.skill)
            .map((point) => ({ beat: point.beat, seconds: this.beatToSeconds(point.beat, timeline) }));
    }
}
