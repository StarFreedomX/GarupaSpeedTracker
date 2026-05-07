import type { Chart, ChartItem, ConnectionNote } from "@/types/bestdori/chart";
import type { SkillDuration, SongLevelSummary, SongSummary } from "@/types/songMetadata";

const SKILL_DURATIONS = ["3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0"] as const satisfies readonly SkillDuration[];
const DEFAULT_BPM = 120;
const TARGET_SKILL_COUNT = 6;

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

        return {
            level,
            total: normalized.total,
            counts,
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

    private buildCounts(normalized: NormalizedChart): Record<SkillDuration, number[]> {
        const counts = {} as Record<SkillDuration, number[]>;
        const skillEvents = normalized.skillEvents.slice();

        // The game design requires exactly TARGET_SKILL_COUNT skill trigger points per chart.
        // If the parsed chart does not contain exactly that many, fail fast so data issues
        // (missing or extra skill markers) are surfaced instead of silently padding.
        if (skillEvents.length !== TARGET_SKILL_COUNT) {
            throw new Error(`Expected ${TARGET_SKILL_COUNT} skill events, but parsed ${skillEvents.length}.`);
        }

        for (const duration of SKILL_DURATIONS) {
            const windowSeconds = Number(duration);
            counts[duration] = skillEvents.map((skillEvent) => {
                const windowEnd = skillEvent.seconds + windowSeconds;
                return normalized.noteEvents.reduce((sum, noteEvent) => {
                    if (noteEvent.seconds <= skillEvent.seconds) {
                        return sum;
                    }

                    if (noteEvent.seconds > windowEnd) {
                        return sum;
                    }

                    return sum + 1;
                }, 0);
            });
        }

        return counts;
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
            // connection points may carry skill flag on the point itself
            const points = (item as ConnectionNote).connections || [];
            return points.filter((p) => (p as any).skill).map((p) => ({ beat: p.beat, seconds: this.beatToSeconds(p.beat, timeline) }));
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
            .filter((point) => !point.hidden && !(point as any).skill)
            .map((point) => ({ beat: point.beat, seconds: this.beatToSeconds(point.beat, timeline) }));
    }
}
