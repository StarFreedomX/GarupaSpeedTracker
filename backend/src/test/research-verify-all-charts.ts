// noinspection DuplicatedCode
/**
 * 全谱面验证：
 * 1. 新模型 >= 旧模型（所有 fps）
 * 2. 60fps >= 120fps
 *
 * 运行: npx ts-node -r tsconfig-paths/register src/test/research-verify-all-charts.ts
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================
// 从 research-skill-frame-model 复制的核心逻辑
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

function countNotesInSkillWindow(notes: BeatEvent[], skillTime: number, dur: number, fps: number): number {
    const Fs = Math.ceil(skillTime * fps);
    const Fe = Fs + Math.ceil(dur * fps - FPS_EPSILON) + 1;
    let c = 0;
    for (const n of notes) {
        if (n.seconds <= skillTime) continue;
        const Fn = Math.ceil(n.seconds * fps);
        if (Fn > Fs && Fn <= Fe) c++;
        else if (Fn > Fe) break;
    }
    return c;
}

function buildCounts(n: NormalizedChart, fps: number): number[][] {
    if (n.skillEvents.length !== TARGET_SKILL_COUNT) throw new Error(`skill count=${n.skillEvents.length}`);
    return SKILL_DURATION_SECONDS.map((d) => n.skillEvents.map((s) => countNotesInSkillWindow(n.noteEvents, s.seconds, d, fps)));
}

function buildCountsOld(n: NormalizedChart): number[][] {
    if (n.skillEvents.length !== TARGET_SKILL_COUNT) throw new Error(`skill count=${n.skillEvents.length}`);
    return SKILL_DURATION_SECONDS.map((ws) =>
        n.skillEvents.map((se) => {
            const we = se.seconds + ws;
            let c = 0;
            for (const ne of n.noteEvents) {
                if (ne.seconds <= se.seconds) continue;
                if (ne.seconds > we) break;
                c++;
            }
            return c;
        }),
    );
}

// ============================================================
// 主逻辑
// ============================================================

const CHARTS_DIR = join(__dirname, "..", "..", "data", "raw", "charts");

interface Violation {
    songId: string;
    difficulty: string;
    duration: string;
    skillIdx: number;
    old: number;
    new120: number;
    new60: number;
}

function scanAll(): void {
    const songDirs = readdirSync(CHARTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    console.log(`Scanning ${songDirs.length} songs...\n`);

    const vNewVsOld: Violation[] = [];
    const v60vs120: Violation[] = [];
    let totalCharts = 0;
    let skippedNoSkill = 0;
    let skippedBadSkillCount = 0;

    const diffDistNewVsOld: Record<number, number> = {};
    const diffDist60vs120: Record<number, number> = {};
    const allResults: Array<{
        songId: string;
        difficulty: string;
        duration: string;
        skillIdx: number;
        old: number;
        new120: number;
        new60: number;
        dNewVsOld: number;
        d60vs120: number;
    }> = [];
    let maxNewVsOld = 0;
    let max60vs120 = 0;

    for (const dir of songDirs) {
        const songId = dir.name;
        const songDir = join(CHARTS_DIR, songId);
        const files = readdirSync(songDir).filter((f) => f.endsWith(".json"));

        for (const file of files) {
            const diff = file.replace(".json", "");

            totalCharts++;
            const raw = readFileSync(join(songDir, file), "utf-8");
            const items: ChartItem[] = JSON.parse(raw);

            let n: NormalizedChart;
            try {
                n = normalizeChart(items);
            } catch {
                skippedBadSkillCount++;
                continue;
            }

            // 技能点不足（比如某些 easy 谱面可能不足 6 个技能键）
            if (n.skillEvents.length !== TARGET_SKILL_COUNT) {
                if (n.skillEvents.length === 0) skippedNoSkill++;
                else skippedBadSkillCount++;
                continue;
            }

            const cOld = buildCountsOld(n);
            const c120 = buildCounts(n, 120);
            const c60 = buildCounts(n, 60);

            for (let di = 0; di < SKILL_DURATION_SECONDS.length; di++) {
                const dur = SKILL_DURATION_SECONDS[di].toFixed(1);
                for (let si = 0; si < TARGET_SKILL_COUNT; si++) {
                    const dNewVsOld = c120[di][si] - cOld[di][si];
                    const d60vs120 = c60[di][si] - c120[di][si];

                    if (dNewVsOld > maxNewVsOld) maxNewVsOld = dNewVsOld;
                    if (d60vs120 > max60vs120) max60vs120 = d60vs120;
                    diffDistNewVsOld[dNewVsOld] = (diffDistNewVsOld[dNewVsOld] || 0) + 1;
                    diffDist60vs120[d60vs120] = (diffDist60vs120[d60vs120] || 0) + 1;
                    if (dNewVsOld >= 3 || d60vs120 >= 3) {
                        allResults.push({
                            songId,
                            difficulty: diff,
                            duration: dur,
                            skillIdx: si,
                            old: cOld[di][si],
                            new120: c120[di][si],
                            new60: c60[di][si],
                            dNewVsOld,
                            d60vs120,
                        });
                    }

                    // 不变式 1: 新120 >= 旧
                    if (dNewVsOld < 0) {
                        vNewVsOld.push({ songId, difficulty: diff, duration: dur, skillIdx: si, old: cOld[di][si], new120: c120[di][si], new60: c60[di][si] });
                    }
                    // 不变式 2: 60 >= 120
                    if (d60vs120 < 0) {
                        v60vs120.push({ songId, difficulty: diff, duration: dur, skillIdx: si, old: cOld[di][si], new120: c120[di][si], new60: c60[di][si] });
                    }
                }
            }
        }
    }

    console.log(`Total charts processed: ${totalCharts}`);
    console.log(`  Skipped (no skill events): ${skippedNoSkill}`);
    console.log(`  Skipped (bad skill count): ${skippedBadSkillCount}`);
    console.log();

    if (vNewVsOld.length === 0) {
        console.log("✓ 不变式 1: 新模型 >= 旧模型 — 全部通过");
    } else {
        console.log(`✗ 不变式 1: 新模型 >= 旧模型 — ${vNewVsOld.length} 个违反`);
        for (const v of vNewVsOld.slice(0, 20)) {
            console.log(`  song=${v.songId}/${v.difficulty} dur=${v.duration}s S${v.skillIdx} old=${v.old} new120=${v.new120}`);
        }
        if (vNewVsOld.length > 20) console.log(`  ... and ${vNewVsOld.length - 20} more`);
    }

    if (v60vs120.length === 0) {
        console.log("✓ 不变式 2: 60fps >= 120fps — 全部通过");
    } else {
        console.log(`✗ 不变式 2: 60fps >= 120fps — ${v60vs120.length} 个违反`);
        for (const v of v60vs120.slice(0, 20)) {
            console.log(`  song=${v.songId}/${v.difficulty} dur=${v.duration}s S${v.skillIdx} 120=${v.new120} 60=${v.new60}`);
        }
        if (v60vs120.length > 20) console.log(`  ... and ${v60vs120.length - 20} more`);
    }

    console.log();
    console.log("=== Diff 分布 ===");
    const printDist = (label: string, dist: Record<number, number>, max: number) => {
        const totalCells = Object.values(dist).reduce((a, b) => a + b, 0);
        console.log(`  ${label}:`);
        const keys = Object.keys(dist)
            .map(Number)
            .sort((a, b) => a - b);
        for (const k of keys) {
            const pct = ((dist[k] / totalCells) * 100).toFixed(3);
            console.log(`    +${k}: ${dist[k].toLocaleString()} (${pct}%)`);
        }
        console.log(`    max=${max}, total cells=${totalCells.toLocaleString()}`);
    };
    printDist("新模型 - 旧模型 (120fps)", diffDistNewVsOld, maxNewVsOld);
    printDist("60fps - 120fps", diffDist60vs120, max60vs120);

    // 打印离群值详情 (diff >= 3)
    const outliersNewVsOld = allResults.filter((r) => r.dNewVsOld >= 3);
    const outliers60vs120 = allResults.filter((r) => r.d60vs120 >= 3);
    if (outliersNewVsOld.length > 0) {
        console.log(`\n  离群 (新-旧 >= 3):`);
        for (const r of outliersNewVsOld) {
            console.log(`    song=${r.songId}/${r.difficulty} dur=${r.duration}s S${r.skillIdx} old=${r.old} new120=${r.new120} diff=+${r.dNewVsOld}`);
        }
    }
    if (outliers60vs120.length > 0) {
        console.log(`\n  离群 (60-120 >= 3):`);
        for (const r of outliers60vs120) {
            console.log(`    song=${r.songId}/${r.difficulty} dur=${r.duration}s S${r.skillIdx} 120=${r.new120} 60=${r.new60} diff=+${r.d60vs120}`);
        }
    }
}

scanAll();
