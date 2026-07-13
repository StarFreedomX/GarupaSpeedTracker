// noinspection DuplicatedCode
/**
 * 研究：检查所有谱面的技能触发点间隔
 * 输出所有触发点间隔 < 8s 的谱面（可能发生技能窗口重叠）
 *
 * 用法: npx tsx src/test/research-skill-overlap.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============ 简易类型定义（避免依赖项目内部模块） ============

interface NotePoint {
    lane: number;
    beat: number;
    skill?: boolean;
    hidden?: boolean;
}

interface ChartItem {
    type: string;
    beat?: number;
    bpm?: number;
    skill?: boolean;
    connections?: NotePoint[];
}

type BpmPoint = [number, number];

interface TimelineEntry {
    beat: number;
    bpm: number;
    seconds: number;
}

interface SkillEvent {
    beat: number;
    seconds: number;
}

// ============ BPM 时间线计算（复制自 BestdoriChartParser） ============

const DEFAULT_BPM = 120;
const MAX_SKILL_DURATION = 8.75 + 1 / 60;

function extractBpmList(items: ChartItem[]): BpmPoint[] {
    return items
        .filter((item): item is ChartItem & { type: "BPM"; bpm: number } => item.type === "BPM")
        .sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0))
        .map((event) => [event.beat ?? 0, event.bpm ?? DEFAULT_BPM] as BpmPoint);
}

function buildBpmTimeline(bpmList: BpmPoint[]): TimelineEntry[] {
    const sorted = bpmList.slice().sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) {
        return [{ beat: 0, bpm: DEFAULT_BPM, seconds: 0 }];
    }

    const timeline: TimelineEntry[] = [];
    let currentSeconds = 0;
    let currentBeat = sorted[0][0];
    let currentBpm = sorted[0][1] > 0 ? sorted[0][1] : DEFAULT_BPM;

    timeline.push({ beat: currentBeat, bpm: currentBpm, seconds: currentSeconds });

    for (let i = 1; i < sorted.length; i++) {
        const [nextBeat, nextBpmRaw] = sorted[i];
        const nextBpm = nextBpmRaw > 0 ? nextBpmRaw : DEFAULT_BPM;
        currentSeconds += ((nextBeat - currentBeat) * 60) / currentBpm;
        currentBeat = nextBeat;
        currentBpm = nextBpm;
        timeline.push({ beat: currentBeat, bpm: currentBpm, seconds: currentSeconds });
    }

    if (timeline[0].beat > 0) {
        timeline.unshift({ beat: 0, bpm: timeline[0].bpm, seconds: 0 });
    }

    return timeline;
}

function beatToSeconds(beat: number, timeline: TimelineEntry[]): number {
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

function extractSkillEvents(items: ChartItem[], timeline: TimelineEntry[]): SkillEvent[] {
    const events: SkillEvent[] = [];

    for (const item of items) {
        if (item.type === "Single" && item.skill) {
            events.push({ beat: item.beat ?? 0, seconds: beatToSeconds(item.beat ?? 0, timeline) });
        } else if (item.type === "Long" || item.type === "Slide") {
            const points = item.connections || [];
            for (const p of points) {
                if (p.skill && !p.hidden) {
                    events.push({ beat: p.beat, seconds: beatToSeconds(p.beat, timeline) });
                }
            }
        }
    }

    // 同一 beat 的多个技能标记折叠为一个触发点
    const deduped: SkillEvent[] = [];
    for (const e of events) {
        if (deduped.length === 0) {
            deduped.push(e);
            continue;
        }
        const prev = deduped[deduped.length - 1];
        if (Math.abs(prev.beat - e.beat) <= 1e-6) {
            continue;
        }
        deduped.push(e);
    }

    return deduped;
}

// ============ 主逻辑 ============

const CHARTS_DIR = join(__dirname, "..", "..", "data", "raw", "charts");

if (!existsSync(CHARTS_DIR)) {
    console.error(`谱面目录不存在: ${CHARTS_DIR}`);
    console.error("请先开启 rawChartStorage 并运行 songMetadataService 下载谱面。");
    process.exit(1);
}

const songDirs = readdirSync(CHARTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => Number(a.name) - Number(b.name));

let overlapCount = 0;
let totalCharts = 0;
const results: Array<{
    songId: string;
    difficulty: string;
    totalSkillEvents: number;
    minGap: number;
    gaps: number[];
    skillEvents: SkillEvent[];
}> = [];

for (const dir of songDirs) {
    const songId = dir.name;
    const songDir = join(CHARTS_DIR, songId);
    const files = readdirSync(songDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
        const difficulty = file.replace(".json", "");
        totalCharts++;

        try {
            const raw = readFileSync(join(songDir, file), "utf-8");
            const items: ChartItem[] = JSON.parse(raw);

            const bpmList = extractBpmList(items);
            const timeline = buildBpmTimeline(bpmList);
            const skillEvents = extractSkillEvents(items, timeline);

            const gaps: number[] = [];
            let minGap = Number.POSITIVE_INFINITY;
            for (let i = 1; i < skillEvents.length; i++) {
                const gap = skillEvents[i].seconds - skillEvents[i - 1].seconds;
                if (gap < MAX_SKILL_DURATION) {
                    gaps.push(gap);
                    if (gap < minGap) minGap = gap;
                }
            }

            if (gaps.length > 0) {
                overlapCount++;
                results.push({ songId, difficulty, totalSkillEvents: skillEvents.length, minGap, gaps, skillEvents });
            }
        } catch {
            // 跳过解析失败的谱面
        }
    }
}

// ============ 输出 ============

console.log("=".repeat(60));
console.log("技能触发点间隔 < 8s 的谱面列表");
console.log("=".repeat(60));

if (results.length === 0) {
    console.log("\n未发现任何谱面存在 < 8s 的技能触发间隔。");
} else {
    for (const r of results) {
        const gapList = r.gaps.map((g) => `${g.toFixed(2)}s`).join(", ");
        console.log(`\n[song=${r.songId}] [${r.difficulty}] 技能触发点: ${r.totalSkillEvents}个, 最小间隔: ${r.minGap.toFixed(2)}s`);
        console.log(`  超出间隔: ${gapList}`);
        for (let i = 0; i < r.skillEvents.length; i++) {
            const e = r.skillEvents[i];
            const gap = i > 0 ? ` (gap=${(e.seconds - r.skillEvents[i - 1].seconds).toFixed(2)}s)` : "";
            const marker = i > 0 && e.seconds - r.skillEvents[i - 1].seconds < MAX_SKILL_DURATION ? " ← overlap" : "";
            console.log(`    #${i}: beat=${e.beat.toFixed(2).padStart(8)}  time=${e.seconds.toFixed(2).padStart(7)}s${gap}${marker}`);
        }
    }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`总谱面数: ${totalCharts}`);
console.log(`存在 < ${MAX_SKILL_DURATION}s 间隔的谱面数: ${overlapCount}`);
console.log(`${"=".repeat(60)}`);
