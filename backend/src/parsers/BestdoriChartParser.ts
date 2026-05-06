import type { Chart, ChartItem, ConnectionNote } from "@/types/bestdori/chart";
import type { SkillDuration, SongSummary } from "@/types/songMetadata";

const SKILL_DURATIONS = ["3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0"] as const satisfies readonly SkillDuration[];
const DEFAULT_BPM = 120;
const TARGET_SKILL_COUNT = 6;

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let crc = index;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
        table[index] = crc >>> 0;
    }

    return table;
})();

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
    public buildSongSummary(songId: number, level: number, chart: Chart): SongSummary {
        const normalized = this.normalizeChart(chart);
        const counts = this.buildCounts(normalized);
        const summary = {
            song_id: songId,
            level,
            total: normalized.total,
            counts,
        };

        return {
            ...summary,
            hash: this.buildHash(summary),
        };
    }

    private normalizeChart(chart: Chart): NormalizedChart {
        const bpmTimeline = this.buildBpmTimeline(this.extractBpmList(chart));
        const skillEvents = chart.flatMap((item) => this.extractSkillEvents(item, bpmTimeline)).sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);
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
        const skillEvents = normalized.skillEvents.slice(0, TARGET_SKILL_COUNT);

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

            while (counts[duration].length < TARGET_SKILL_COUNT) {
                counts[duration].push(0);
            }
        }

        return counts;
    }

    private buildHash(data: Omit<SongSummary, "hash">): string {
        const input = JSON.stringify(data);
        let hash = 0xffffffff;

        for (let index = 0; index < input.length; index += 1) {
            hash = CRC32_TABLE[(hash ^ input.charCodeAt(index)) & 0xff] ^ (hash >>> 8);
        }

        return ((hash ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
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
        if (item.type !== "Single" || !item.skill) {
            return [];
        }

        return [{ beat: item.beat, seconds: this.beatToSeconds(item.beat, timeline) }];
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
        return item.connections.filter((point) => !point.hidden).map((point) => ({ beat: point.beat, seconds: this.beatToSeconds(point.beat, timeline) }));
    }
}
