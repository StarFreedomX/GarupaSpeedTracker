// noinspection DuplicatedCode
/**
 * 不稳定区间研究 + 四位小数编码
 *
 * 不稳定区间定义 (analysis_fumeinn_blog2.md §6.2.2):
 *   结束边界 = offset_skill + (递减帧数 + 1) / fps
 *   offset_skill ∈ [0, 1/fps) → 结束边界 ∈ [(d*fps+1)/fps, (d*fps+2)/fps)
 *   落在此时间范围内的 note，加成状态取决于 offset_skill 实际值，不可静态确定。
 *
 * 编码: XX.ABCD
 *   XX  = 120fps 覆盖数
 *   A   = 符号位 (0=+, 1=-)
 *   B   = |60fps - 120fps|
 *   C   = 120fps 不稳定 note 数
 *   D   = 60fps 不稳定 note 数
 *
 * 运行: npx ts-node -r tsconfig-paths/register src/test/research-skill-unstable-encode.ts [songId] [difficulty]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================
// 类型 & 常量
// ============================================================
interface NotePoint {
    lane: number;
    beat: number;
    flick?: boolean;
    hidden?: boolean;
    charge?: boolean;
    skill?: boolean;
}
interface SingleNote {
    type: "Single";
    lane: number;
    beat: number;
    flick?: boolean;
    skill?: boolean;
    charge?: boolean;
}
interface ConnectionNote {
    type: "Long" | "Slide";
    connections: NotePoint[];
}
interface DirectionalNote {
    type: "Directional";
    lane: number;
    beat: number;
    direction: string;
    width: number;
}
interface BPMEvent {
    type: "BPM";
    bpm: number;
    beat: number;
}
interface SystemEvent {
    type: "System";
    data: string;
    beat: number;
}
type ChartItem = BPMEvent | SystemEvent | SingleNote | ConnectionNote | DirectionalNote;
interface BeatEvent {
    beat: number;
    seconds: number;
}
interface NormalizedChart {
    total: number;
    noteEvents: BeatEvent[];
    skillEvents: BeatEvent[];
}

const SKILL_DURATION_SECONDS = Array.from({ length: 51 }, (_, i) => (30 + i) / 10);
const TARGET_SKILL_COUNT = 6;
const DEFAULT_BPM = 120;
const FPS_EPSILON = 1e-9;

// ============================================================
// Chart 归一化 (复制)
// ============================================================
function extractBpmList(items: ChartItem[]): Array<{ beat: number; bpm: number; seconds: number }> {
    const bpmEvents = items.filter((item): item is BPMEvent => item.type === "BPM").sort((a, b) => a.beat - b.beat || a.bpm - b.bpm);
    if (bpmEvents.length === 0) return [{ beat: 0, bpm: DEFAULT_BPM, seconds: 0 }];
    const timeline: Array<{ beat: number; bpm: number; seconds: number }> = [];
    let cs = 0,
        cb = bpmEvents[0].beat,
        cBpm = bpmEvents[0].bpm > 0 ? bpmEvents[0].bpm : DEFAULT_BPM;
    timeline.push({ beat: cb, bpm: cBpm, seconds: cs });
    for (let i = 1; i < bpmEvents.length; i++) {
        const nb = bpmEvents[i].beat,
            nBpm = bpmEvents[i].bpm > 0 ? bpmEvents[i].bpm : DEFAULT_BPM;
        cs += ((nb - cb) * 60) / cBpm;
        cb = nb;
        cBpm = nBpm;
        timeline.push({ beat: cb, bpm: cBpm, seconds: cs });
    }
    if (timeline[0].beat > 0) timeline.unshift({ beat: 0, bpm: timeline[0].bpm, seconds: 0 });
    return timeline;
}

function beatToSeconds(beat: number, tl: Array<{ beat: number; bpm: number; seconds: number }>): number {
    let s = tl[0];
    for (const p of tl) {
        if (p.beat <= beat) s = p;
        else break;
    }
    return s.seconds + ((beat - s.beat) * 60) / s.bpm;
}

function normalizeChart(items: ChartItem[]): NormalizedChart {
    const tl = extractBpmList(items);
    let skillEvents = items
        .flatMap((it) => {
            if (it.type === "Single") return it.skill ? [{ beat: it.beat, seconds: beatToSeconds(it.beat, tl) }] : [];
            if (it.type === "Long" || it.type === "Slide")
                return (it as ConnectionNote).connections.filter((p) => p.skill).map((p) => ({ beat: p.beat, seconds: beatToSeconds(p.beat, tl) }));
            return [];
        })
        .sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);
    const deduped: BeatEvent[] = [];
    for (const se of skillEvents) {
        if (deduped.length === 0 || Math.abs(deduped[deduped.length - 1].beat - se.beat) > 1e-6) deduped.push(se);
    }
    skillEvents = deduped;
    const noteEvents = items
        .flatMap((it) => {
            if (it.type === "Single") return it.skill ? [] : [{ beat: it.beat, seconds: beatToSeconds(it.beat, tl) }];
            if (it.type === "Directional") return [{ beat: it.beat, seconds: beatToSeconds(it.beat, tl) }];
            if (it.type === "Long" || it.type === "Slide")
                return (it as ConnectionNote).connections
                    .filter((p) => !p.hidden && !p.skill)
                    .map((p) => ({ beat: p.beat, seconds: beatToSeconds(p.beat, tl) }));
            return [];
        })
        .sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);
    return { total: skillEvents.length + noteEvents.length, noteEvents, skillEvents };
}

// ============================================================
// 帧计数 + 不稳定区间计数
// ============================================================

interface SkillResult {
    count: number;
    unstableCount: number;
}

function analyzeSkillWindow(noteEvents: BeatEvent[], skillTime: number, durationSec: number, fps: number): SkillResult {
    const F_s = Math.ceil(skillTime * fps);
    const F_end = F_s + Math.ceil(durationSec * fps - FPS_EPSILON) + 1;

    // 确定性覆盖: F_n ∈ (F_s, F_end]
    let count = 0;
    let unstableCount = 0;

    // 不稳定区间: [skillTime + (ceil(d*fps)+1)/fps, skillTime + (ceil(d*fps)+2)/fps)
    // 即 note 绝对时间落在 [unstableStart, unstableEnd) 内
    const bonusFrames = Math.ceil(durationSec * fps - FPS_EPSILON);
    const unstableStart = skillTime + (bonusFrames + 1) / fps;
    const unstableEnd = skillTime + (bonusFrames + 2) / fps;

    let inWindow = true; // 还在确定性窗口内
    for (const note of noteEvents) {
        if (note.seconds <= skillTime) continue;

        const F_n = Math.ceil(note.seconds * fps);

        // 确定性覆盖
        if (inWindow && F_n > F_s && F_n <= F_end) {
            count++;
        }
        if (inWindow && F_n > F_end) {
            inWindow = false; // 确定性窗口结束，但继续遍历不稳定区间
        }

        // 不稳定判断
        if (note.seconds >= unstableStart && note.seconds < unstableEnd) {
            unstableCount++;
        } else if (note.seconds >= unstableEnd) {
            break; // 不稳定区间也结束了
        }
    }

    return { count, unstableCount };
}

function buildResults(n: NormalizedChart, fps: number): Array<Array<SkillResult>> {
    if (n.skillEvents.length !== TARGET_SKILL_COUNT) throw new Error(`skill count=${n.skillEvents.length}`);
    return SKILL_DURATION_SECONDS.map((d) => n.skillEvents.map((s) => analyzeSkillWindow(n.noteEvents, s.seconds, d, fps)));
}

// ============================================================
// 编码
// ============================================================

function encode(base120: number, diff: number, unstable120: number, unstable60: number): number {
    const sign = diff >= 0 ? 0 : 1;
    const magnitude = Math.abs(diff);
    const raw = base120 + sign * 0.1 + magnitude * 0.01 + unstable120 * 0.001 + unstable60 * 0.0001;
    return Math.round(raw * 10000) / 10000;
}

function decode(value: number): { base120: number; diff: number; unstable120: number; unstable60: number } {
    const base120 = Math.floor(value);
    const frac = Math.round((value - base120) * 10000) / 10000;
    const signBit = Math.floor(frac * 10);
    const magnitude = Math.round((frac * 100) % 10);
    const unstable120 = Math.round((frac * 1000) % 10);
    const unstable60 = Math.round((frac * 10000) % 10);
    const diff = signBit === 0 ? magnitude : -magnitude;
    return { base120, diff, unstable120, unstable60 };
}

// ============================================================
// 输出
// ============================================================

function main() {
    const songId = process.argv[2] || "1";
    const difficulty = process.argv[3] || "expert";
    const chartPath = join(__dirname, "..", "..", "data", "raw", "charts", songId, `${difficulty}.json`);
    console.log(`Chart: songId=${songId} (${difficulty})\n`);

    const items: ChartItem[] = JSON.parse(readFileSync(chartPath, "utf-8"));
    const n = normalizeChart(items);

    const r120 = buildResults(n, 120);
    const r60 = buildResults(n, 60);

    console.log("Duration  120fps(count+unstable)  60fps(count+unstable)  diff     Encoded         Decoded");
    console.log("─".repeat(100));

    let maxDiff = 0;
    let maxUnstable120 = 0;
    let maxUnstable60 = 0;
    let totalDiffZero = 0;
    let totalDiffNonZero = 0;
    let totalUnstableNonZero = 0;

    const SM = TARGET_SKILL_COUNT;

    for (let di = 0; di < SKILL_DURATION_SECONDS.length; di++) {
        const dur = SKILL_DURATION_SECONDS[di].toFixed(1);
        const parts: string[] = [];
        for (let si = 0; si < SM; si++) {
            const c120 = r120[di][si];
            const c60 = r60[di][si];
            const diff = c60.count - c120.count;

            if (diff > maxDiff) maxDiff = diff;
            if (c120.unstableCount > maxUnstable120) maxUnstable120 = c120.unstableCount;
            if (c60.unstableCount > maxUnstable60) maxUnstable60 = c60.unstableCount;

            if (diff === 0) totalDiffZero++;
            else totalDiffNonZero++;
            if (c120.unstableCount > 0 || c60.unstableCount > 0) totalUnstableNonZero++;

            const encoded = encode(c120.count, diff, c120.unstableCount, c60.unstableCount);
            const decoded = decode(encoded);

            const _ok =
                decoded.base120 === c120.count &&
                decoded.diff === diff &&
                decoded.unstable120 === c120.unstableCount &&
                decoded.unstable60 === c60.unstableCount;

            let _status = "";
            if (diff !== 0) _status += `Δ${diff >= 0 ? "+" : ""}${diff}`;
            if (c120.unstableCount > 0 || c60.unstableCount > 0) {
                _status += ` U${c120.unstableCount}/${c60.unstableCount}`;
            }

            parts.push(`${String(c120.count).padStart(2)}U${c120.unstableCount}/${String(c60.count).padStart(2)}U${c60.unstableCount}`);
        }
        if (di % 10 === 0) {
            console.log(`${dur.padStart(5)}s  ${parts.join("  ")}`);
        }
    }

    console.log(`\n  max diff=${maxDiff}, max unstable120=${maxUnstable120}, max unstable60=${maxUnstable60}`);
    console.log(`  diff=0 cells: ${totalDiffZero}, diff≠0 cells: ${totalDiffNonZero}`);
    console.log(`  unstable≠0 cells: ${totalUnstableNonZero}`);

    // 找不稳定 > 0 的具体案例
    console.log("\n=== 不稳定 note 案例 (unstable > 0) ===");
    let shown = 0;
    for (let di = 0; di < SKILL_DURATION_SECONDS.length && shown < 20; di++) {
        for (let si = 0; si < SM && shown < 20; si++) {
            const c120 = r120[di][si];
            const c60 = r60[di][si];
            if (c120.unstableCount > 0 || c60.unstableCount > 0) {
                const dur = SKILL_DURATION_SECONDS[di].toFixed(1);
                const diff = c60.count - c120.count;
                const encoded = encode(c120.count, diff, c120.unstableCount, c60.unstableCount);
                console.log(
                    `  ${dur}s S${si}: 120=${c120.count}(U${c120.unstableCount}) 60=${c60.count}(U${c60.unstableCount}) diff=${diff >= 0 ? "+" : ""}${diff} → ${encoded}`,
                );
                shown++;
            }
        }
    }
    if (shown === 0) console.log("  (无 — 所有不稳定计数均为 0)");
}

main();
