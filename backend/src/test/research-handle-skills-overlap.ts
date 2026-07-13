// noinspection DuplicatedCode
/**
 * 研究：对存在技能排队重叠的谱面，计算 shifts[d_prev][d_cur] = deltaNotes
 *
 * 游戏机制：技能 #i 触发时若前一个技能仍在 Playing，不中断，而是写入 playList 排队。
 * 技能 #i-1 跑完后，进入 Finishing 状态逐帧递减 finishingTimer（0.75s），到 0 后
 * 经过 transition + trigger 两帧才为技能 #i 设置 currentPlayingSkillData，下一帧才首次加成。
 *
 * 因此技能 #i 的实际开始时刻 = max(trigger_i, trigger_{i-1} + d_{i-1} + FINISH_GAP)
 * Delta = 实际覆盖 note 数 - 原始 counts 中基于 trigger_i 的覆盖 note 数
 *
 * 用法: npx tsx src/test/research-handle-skills-overlap.ts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============ 配置 ============

/**
 * Finishing 空窗时长（秒）。
 * IDA 分析: finishingTimer = 0.75f，逐帧递减到 ≤0 后：
 *   - 过渡帧: changeState(0)→changeState(1)
 *   - 触发帧: Case 1 设置 currentPlayingSkillData（NoteManager 在本帧已跑完，无加成）
 *   - 下一帧: 首次加成
 * 所以空窗 ≈ 0.75 + 2/fps。此处用 60fps 近似值供研究使用。
 */
const FINISH_GAP = 0.75 + 2 / 60; // ≈ 0.783s

/** 判定帧率 */
const FPS = 60;
const FPS_EPSILON = 1e-9;

/** 仅处理间隔 < 此值的相邻技能触发点 */
const OVERLAP_THRESHOLD = 8.75 + 1 / 60;

/** 17 个有效技能时长 */
const SKILL_DURATIONS = ["3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "5.6", "5.7", "6.0", "6.2", "6.4", "6.5", "6.8", "7.0", "7.2", "7.5", "8.0"] as const;

// ============ 类型 ============

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

interface NoteEvent {
    seconds: number;
}

interface NormalizedChart {
    skillEvents: SkillEvent[];
    noteEvents: NoteEvent[];
}

// ============ BPM 时间线 ============

const DEFAULT_BPM = 120;

function extractBpmList(items: ChartItem[]): BpmPoint[] {
    return items
        .filter((item): item is ChartItem & { type: "BPM"; bpm: number } => item.type === "BPM")
        .sort((a, b) => (a.beat ?? 0) - (b.beat ?? 0))
        .map((event) => [event.beat ?? 0, event.bpm ?? DEFAULT_BPM] as BpmPoint);
}

function buildBpmTimeline(bpmList: BpmPoint[]): TimelineEntry[] {
    const sorted = bpmList.slice().sort((a, b) => a[0] - b[0]);
    if (sorted.length === 0) return [{ beat: 0, bpm: DEFAULT_BPM, seconds: 0 }];

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

// ============ 提取技能事件和 note 事件 ============

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

    // 同 beat 去重
    const deduped: SkillEvent[] = [];
    for (const e of events) {
        if (deduped.length === 0) {
            deduped.push(e);
            continue;
        }
        const prev = deduped[deduped.length - 1];
        if (Math.abs(prev.beat - e.beat) <= 1e-6) continue;
        deduped.push(e);
    }

    return deduped;
}

function extractNoteEvents(items: ChartItem[], timeline: TimelineEntry[]): NoteEvent[] {
    const events: NoteEvent[] = [];

    for (const item of items) {
        switch (item.type) {
            case "Single":
                if (!item.skill) events.push({ seconds: beatToSeconds(item.beat ?? 0, timeline) });
                break;
            case "Directional":
                events.push({ seconds: beatToSeconds(item.beat ?? 0, timeline) });
                break;
            case "Long":
            case "Slide":
                for (const p of item.connections || []) {
                    if (!p.hidden && !p.skill) {
                        events.push({ seconds: beatToSeconds(p.beat, timeline) });
                    }
                }
                break;
        }
    }

    return events.sort((a, b) => a.seconds - b.seconds);
}

function normalizeChart(items: ChartItem[]): NormalizedChart {
    const bpmList = extractBpmList(items);
    const timeline = buildBpmTimeline(bpmList);
    return {
        skillEvents: extractSkillEvents(items, timeline),
        noteEvents: extractNoteEvents(items, timeline),
    };
}

// ============ 帧计数模型 ============

/**
 * 帧模型计数（与 BestdoriChartParser.countNotesInWindow 一致）:
 * 技能窗口 = (Fs, Fe]，Fs = ceil(skillTime * fps), Fe = Fs + ceil(dur * fps - ε) + 1
 */
function countNotesInWindow(noteEvents: NoteEvent[], skillTime: number, durationSec: number): number {
    const Fs = Math.ceil(skillTime * FPS);
    const Fe = Fs + Math.ceil(durationSec * FPS - FPS_EPSILON) + 1;

    let count = 0;
    for (const note of noteEvents) {
        if (note.seconds <= skillTime) continue;
        const Fn = Math.ceil(note.seconds * FPS);
        if (Fn > Fs && Fn <= Fe) count++;
        else if (Fn > Fe) break;
    }
    return count;
}

// ============ 核心：计算 overlaps ============

/**
 * 帧模型精确版：prevEnd 和 GAP 都用帧号算
 *
 * 技能 #i-1 的帧时间线：
 *   F_prev = ceil(trigger_{i-1} * fps)                     — 触发帧（无加成）
 *   + ceil(d_{i-1} * fps - ε) 帧                            — 递减帧（有加成）
 *   + 1 帧                                                   — 结束帧（有加成，随后 FinishSkill）
 *
 * 之后空窗：
 *   + ceil(0.75 * fps) 帧                                    — Finishing decrement（t>0 逐帧减）
 *   + 1 帧                                                   — 过渡帧（t≤0 → changeState(0)→(1)）
 *   + 1 帧                                                   — 技能 #i 触发帧（Case 1 设指针，无加成）
 *
 * 技能 #i 的首个加成帧（F_actual_i 减 1）：
 *   FsCur = ceil(trigger_{i-1} * fps)
 *          + ceil(d_{i-1} * fps - ε) + 1     // prev decrement + end
 *          + ceil(0.75 * fps) + 1 + 1        // finishing + transition + trigger
 *        = ceil(trigger_{i-1} * fps) + ceil(d_{i-1} * fps - ε) + ceil(0.75 * fps) + 3
 *
 * 注意这是技能 #i 的触发帧（trigger frame），不是首个加成帧。
 * countNotesInWindow 的 Fs = 触发帧号，(Fs, Fe] 不含触发帧，
 * 所以实际计数的第一帧 = Fs + 1 = 首个加成帧，符合预期。
 *
 * 然后 delayedStart = FsCur / fps （使得 ceil(delayedStart * fps) = FsCur）
 */
function computePositionShifts(noteEvents: NoteEvent[], triggerTimePrev: number, triggerTimeCur: number): Record<string, Record<string, number>> {
    const shifts: Record<string, Record<string, number>> = {};

    for (const dPrev of SKILL_DURATIONS) {
        const durPrev = Number(dPrev);

        // 前技能结束后的第一个空窗帧号
        const FsPrev = Math.ceil(triggerTimePrev * FPS);
        const prevCoverageFrames = Math.ceil(durPrev * FPS - FPS_EPSILON) + 1; // decrement + end frame
        const gapFrames = Math.ceil(0.75 * FPS) + 1 + 1; // finishing decrement + transition + trigger

        // 技能 #i 的首个加成帧
        const FsBonus = FsPrev + prevCoverageFrames + gapFrames;

        // 技能 #i 的 Fs（用于 countNotesInWindow 的 Fs 参数）
        const FsCur = Math.max(Math.ceil(triggerTimeCur * FPS), FsBonus);

        // 换算成秒作为 delayedStart（countNotesInWindow 内部会 ceil 回去，所以整除以 fps 即可）
        const delayedStart = FsCur / FPS;

        const shiftsForPrev: Record<string, number> = {};

        for (const dCur of SKILL_DURATIONS) {
            const durCur = Number(dCur);

            // 基线：从触发时刻开始的窗口
            const baseline = countNotesInWindow(noteEvents, triggerTimeCur, durCur);

            // 实际：排队后的窗口
            const actual = countNotesInWindow(noteEvents, delayedStart, durCur);

            const delta = actual - baseline;
            if (delta !== 0) {
                shiftsForPrev[dCur] = delta;
            }
        }

        if (Object.keys(shiftsForPrev).length > 0) {
            shifts[dPrev] = shiftsForPrev;
        }
    }

    return shifts;
}

// ============ 主逻辑 ============

const CHARTS_DIR = join(__dirname, "..", "..", "data", "raw", "charts");

if (!existsSync(CHARTS_DIR)) {
    console.error(`谱面目录不存在: ${CHARTS_DIR}`);
    process.exit(1);
}

const songDirs = readdirSync(CHARTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => Number(a.name) - Number(b.name));

interface OverlapResult {
    songId: string;
    difficulty: string;
    /**
     * overlaps[pos] = { [prevDur]: { [curDur]: delta } }
     * pos 是 1-indexed（第 pos 个位置存在排队偏移，依赖 pos-1 的技能时长）
     */
    overlaps: Record<number, Record<string, Record<string, number>>>;
    skillEvents: SkillEvent[];
}

const results: OverlapResult[] = [];
let totalCharts = 0;

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
            const { skillEvents, noteEvents } = normalizeChart(items);

            if (skillEvents.length !== 6) continue; // 只处理标准 6 触发的谱面

            const overlaps: Record<number, Record<string, Record<string, number>>> = {};

            for (let i = 1; i < skillEvents.length; i++) {
                const gap = skillEvents[i].seconds - skillEvents[i - 1].seconds;
                if (gap < OVERLAP_THRESHOLD) {
                    const shifts = computePositionShifts(noteEvents, skillEvents[i - 1].seconds, skillEvents[i].seconds);
                    if (Object.keys(shifts).length > 0) {
                        overlaps[i] = shifts;
                    }
                }
            }

            if (Object.keys(overlaps).length > 0) {
                results.push({ songId, difficulty, overlaps, skillEvents });
            }
        } catch {
            // skip broken charts
        }
    }
}

// ============ 级联排队验证 ============
// 对存在连续重叠位置的谱面（如 pos=1,2 或 pos=4,5），验证一阶模型 vs 真实链模型

console.log(`\n${"=".repeat(60)}`);
console.log("级联排队验证：一阶模型(d_prev only) vs 真实链(累积所有前驱)");
console.log("=".repeat(60));

interface CascadeCase {
    songId: string;
    difficulty: string;
    /** 连续排队位置 [pos, pos+1] */
    positions: [number, number];
    skillEvents: SkillEvent[];
}

const cascadeCases: CascadeCase[] = [];

for (const r of results) {
    const positions = Object.keys(r.overlaps)
        .map(Number)
        .sort((a, b) => a - b);
    for (let i = 0; i < positions.length - 1; i++) {
        if (positions[i + 1] === positions[i] + 1) {
            cascadeCases.push({
                songId: r.songId,
                difficulty: r.difficulty,
                positions: [positions[i], positions[i + 1]],
                skillEvents: r.skillEvents,
            });
        }
    }
}

if (cascadeCases.length === 0) {
    console.log("没有连续排队谱面，无需验证。");
} else {
    // 对每个级联案例，采样代表性的 duration 组合
    const SAMPLE_DURATIONS = ["5.0", "6.0", "7.0", "8.0"]; // 只采样 4 个最常见时长

    let _totalCompared = 0;
    let mismatchCount = 0;
    let maxMismatch = 0;

    for (const cc of cascadeCases) {
        const pos1 = cc.positions[0]; // 第一个排队位置
        const pos2 = cc.positions[1]; // 第二个排队位置（连续的）

        // 需要读取这个谱面的 chart 数据来获取 noteEvents
        // 简化：从已有 results 中查找对应 chart 的原始数据
        // （此处不重复完整 parse，只对找到的 cascade case 重新解析）

        // 重新加载谱面
        const chartPathDir = join(CHARTS_DIR, cc.songId);
        const diffFiles = readdirSync(chartPathDir).filter((f) => f.endsWith(".json"));
        const diffFile = diffFiles.find((f) => f.replace(".json", "") === cc.difficulty);
        if (!diffFile) continue;

        const raw = readFileSync(join(chartPathDir, diffFile), "utf-8");
        const items: ChartItem[] = JSON.parse(raw);
        const { skillEvents: se, noteEvents: ne } = normalizeChart(items);

        const trigger0 = se[pos1 - 1].seconds; // 第一个排队位置的前驱触发时刻
        const trigger1 = se[pos1].seconds; // 第一个排队位置的触发时刻
        const trigger2 = se[pos2].seconds; // 第二个排队位置的触发时刻

        const mismatches: Array<{ d0: string; d1: string; d2: string; simpleDelta: number; chainDelta: number }> = [];

        for (const d0 of SAMPLE_DURATIONS) {
            for (const d1 of SAMPLE_DURATIONS) {
                for (const d2 of SAMPLE_DURATIONS) {
                    const dur0 = Number(d0);
                    const dur1 = Number(d1);
                    const dur2 = Number(d2);

                    // 一阶模型：skill #1 从 trigger1 开始
                    const simpleStart2 = Math.max(trigger2, trigger1 + dur1 + FINISH_GAP);
                    const simpleCount = countNotesInWindow(ne, simpleStart2, dur2);

                    // 真实链：skill #1 可能被 skill #0 延迟
                    const actualStart1 = Math.max(trigger1, trigger0 + dur0 + FINISH_GAP);
                    const chainStart2 = Math.max(trigger2, actualStart1 + dur1 + FINISH_GAP);
                    const chainCount = countNotesInWindow(ne, chainStart2, dur2);

                    // 基线（无延迟）
                    const baseline = countNotesInWindow(ne, trigger2, dur2);

                    const simpleDelta = simpleCount - baseline;
                    const chainDelta = chainCount - baseline;

                    if (simpleDelta !== chainDelta) {
                        _totalCompared++;
                        mismatchCount++;
                        if (Math.abs(simpleDelta - chainDelta) > maxMismatch) {
                            maxMismatch = Math.abs(simpleDelta - chainDelta);
                        }
                        mismatches.push({ d0, d1, d2, simpleDelta, chainDelta });
                    }
                }
            }
        }

        if (mismatches.length > 0) {
            // 只输出 mismatches
            console.log(`\n[song=${cc.songId}] [${cc.difficulty}] pos ${pos1},${pos2} 级联排队：`);
            console.log(`  trigger: #${pos1 - 1}=${trigger0.toFixed(2)}s  #${pos1}=${trigger1.toFixed(2)}s  #${pos2}=${trigger2.toFixed(2)}s`);
            console.log(`  一阶 vs 链 不一致的 (d_prevPrev, d_prev, d_cur) 组合: ${mismatches.length} 个`);

            // 按简单 delta 和链 delta 的差异排序，输出最严重的几个
            mismatches.sort((a, b) => Math.abs(b.simpleDelta - b.chainDelta) - Math.abs(a.simpleDelta - a.chainDelta));
            const topN = mismatches.slice(0, 6);
            for (const m of topN) {
                console.log(
                    `    (${m.d0}, ${m.d1}, ${m.d2}): 一阶=${m.simpleDelta > 0 ? "+" : ""}${m.simpleDelta}  链=${m.chainDelta > 0 ? "+" : ""}${m.chainDelta}`,
                );
            }
        }
    }

    console.log(`\n总比较次数: ~${cascadeCases.length * SAMPLE_DURATIONS.length ** 3} 次`);
    console.log(`不一致次数: ${mismatchCount}`);
    console.log(`最大 delta 差异: ±${maxMismatch} note`);
}

// ============ 输出 ============

// ============ FPS 对 delta 的影响 ==========

console.log(`\n${"=".repeat(60)}`);
console.log("60fps vs 120fps delta 差异分析（代表性谱面）");
console.log("=".repeat(60));

interface FpsConfig {
    fps: number;
    gap: number;
}
const FPS_CONFIGS: FpsConfig[] = [
    { fps: 60, gap: 0.75 + 2 / 60 },
    { fps: 120, gap: 0.75 + 2 / 120 },
];

function countNotesAtFps(notes: NoteEvent[], st: number, dur: number, fps: number): number {
    const eps = 1e-9;
    const Fs = Math.ceil(st * fps);
    const Fe = Fs + Math.ceil(dur * fps - eps) + 1;
    let c = 0;
    for (const n of notes) {
        if (n.seconds <= st) continue;
        const Fn = Math.ceil(n.seconds * fps);
        if (Fn > Fs && Fn <= Fe) c++;
        else if (Fn > Fe) break;
    }
    return c;
}

// 挑有代表性的谱面
const COMPARE_CHARTS = [
    { songId: "66", difficulty: "expert" }, // 两个重叠位
    { songId: "127", difficulty: "expert" }, // 连续排队
    { songId: "162", difficulty: "expert" }, // 单次排队
    { songId: "681", difficulty: "expert" }, // 大偏移
    { songId: "8", difficulty: "expert" }, // 短间隔
];

const DUR_PAIRS = [
    ["5.0", "5.0"],
    ["7.0", "7.0"],
    ["8.0", "8.0"],
    ["7.0", "5.0"],
    ["8.0", "5.0"],
] as const;

let totalDiffs = 0;
let checkedPairs = 0;

for (const ref of COMPARE_CHARTS) {
    const cp = join(CHARTS_DIR, ref.songId, `${ref.difficulty}.json`);
    if (!existsSync(cp)) continue;

    const raw = readFileSync(cp, "utf-8");
    const items: ChartItem[] = JSON.parse(raw);
    const { skillEvents: se2, noteEvents: ne2 } = normalizeChart(items);
    if (se2.length !== 6) continue;

    // 第一个排队位置
    let pos = -1;
    for (let i = 1; i < se2.length; i++) {
        if (se2[i].seconds - se2[i - 1].seconds < OVERLAP_THRESHOLD) {
            pos = i;
            break;
        }
    }
    if (pos < 0) continue;

    const tp = se2[pos - 1].seconds;
    const tc = se2[pos].seconds;
    console.log(`\n[song=${ref.songId}] [${ref.difficulty}] pos=${pos} gap=${(tc - tp).toFixed(2)}s`);

    for (const [dp, dc] of DUR_PAIRS) {
        checkedPairs++;
        const deltas = FPS_CONFIGS.map((cfg) => {
            const s = Math.max(tc, tp + Number(dp) + cfg.gap);
            const bl = countNotesAtFps(ne2, tc, Number(dc), cfg.fps);
            const ac = countNotesAtFps(ne2, s, Number(dc), cfg.fps);
            return ac - bl;
        });

        if (deltas[0] !== deltas[1]) {
            totalDiffs++;
            console.log(`  d_prev=${dp} d_cur=${dc}:  60fps=${deltas[0] > 0 ? "+" : ""}${deltas[0]}  120fps=${deltas[1] > 0 ? "+" : ""}${deltas[1]}  ← 不一致`);
        } else if (deltas[0] !== 0) {
            console.log(`  d_prev=${dp} d_cur=${dc}:  60/120 一致 =${deltas[0] > 0 ? "+" : ""}${deltas[0]}`);
        }
    }
}

console.log(`\n总对比: ${checkedPairs} 对, 60/120fps 不一致: ${totalDiffs}`);

// 直接对比 60fps vs 120fps 实际窗口
if (totalDiffs > 0) {
    console.log("\n--- 60fps vs 120fps 窗口差异（直接比较，不涉及基线） ---");

    for (const ref of COMPARE_CHARTS) {
        const cp = join(CHARTS_DIR, ref.songId, `${ref.difficulty}.json`);
        if (!existsSync(cp)) continue;
        const raw = readFileSync(cp, "utf-8");
        const items: ChartItem[] = JSON.parse(raw);
        const { skillEvents: se2, noteEvents: ne2 } = normalizeChart(items);
        if (se2.length !== 6) continue;

        let pos = -1;
        for (let i = 1; i < se2.length; i++) {
            if (se2[i].seconds - se2[i - 1].seconds < OVERLAP_THRESHOLD) {
                pos = i;
                break;
            }
        }
        if (pos < 0) continue;

        const tp = se2[pos - 1].seconds;
        const tc = se2[pos].seconds;

        for (const [dp, dc] of DUR_PAIRS) {
            const dpn = Number(dp);
            const dcn = Number(dc);

            const st60 = Math.max(tc, tp + dpn + FPS_CONFIGS[0].gap);
            const st120 = Math.max(tc, tp + dpn + FPS_CONFIGS[1].gap);
            if (Math.abs(st60 - st120) < 1e-6) continue; // 没延迟，窗口相同，跳过

            // 直接用原始循环逐个对比
            const only60Notes: number[] = [];
            const only120Notes: number[] = [];
            for (let i = 0; i < ne2.length; i++) {
                const n = ne2[i];
                const in60 = (() => {
                    const eps = 1e-9;
                    const Fs = Math.ceil(st60 * 60);
                    const Fe = Fs + Math.ceil(dcn * 60 - eps) + 1;
                    const Fn = Math.ceil(n.seconds * 60);
                    return n.seconds > st60 && Fn > Fs && Fn <= Fe;
                })();
                const in120 = (() => {
                    const eps = 1e-9;
                    const Fs = Math.ceil(st120 * 120);
                    const Fe = Fs + Math.ceil(dcn * 120 - eps) + 1;
                    const Fn = Math.ceil(n.seconds * 120);
                    return n.seconds > st120 && Fn > Fs && Fn <= Fe;
                })();
                if (in60 && !in120) only60Notes.push(i);
                if (in120 && !in60) only120Notes.push(i);
            }

            if (only60Notes.length === 0 && only120Notes.length === 0) continue;

            const min60Start = st60;
            const min60End = st60 + dcn;
            const min120Start = st120;
            const min120End = st120 + dcn;

            const count60 = ne2.reduce((c, n) => {
                const eps = 1e-9;
                const Fs = Math.ceil(st60 * 60);
                const Fe = Fs + Math.ceil(dcn * 60 - eps) + 1;
                const Fn = Math.ceil(n.seconds * 60);
                return c + (n.seconds > st60 && Fn > Fs && Fn <= Fe ? 1 : 0);
            }, 0);
            const count120 = ne2.reduce((c, n) => {
                const eps = 1e-9;
                const Fs = Math.ceil(st120 * 120);
                const Fe = Fs + Math.ceil(dcn * 120 - eps) + 1;
                const Fn = Math.ceil(n.seconds * 120);
                return c + (n.seconds > st120 && Fn > Fs && Fn <= Fe ? 1 : 0);
            }, 0);

            console.log(`\n[song=${ref.songId}] [${ref.difficulty}] pos=${pos} d_prev=${dp} d_cur=${dc}`);
            console.log(`  60fps: start=${st60.toFixed(3)}s end≈${min60End.toFixed(3)}s notes=${count60} (only60=${only60Notes.length})`);
            console.log(`  120fps: start=${st120.toFixed(3)}s end≈${min120End.toFixed(3)}s notes=${count120} (only120=${only120Notes.length})`);

            for (const idx of only60Notes) {
                const n = ne2[idx];
                const posLabel = n.seconds < min120Start ? "开头-60fps开始晚多丢" : n.seconds > min120End ? "结尾-60fps结束晚多收" : "中间-帧边界";
                console.log(`  60only: idx=${idx} ${n.seconds.toFixed(3)}s ${posLabel}`);
            }
            for (const idx of only120Notes) {
                const n = ne2[idx];
                const posLabel = n.seconds < min60Start ? "开头-120fps开始早多收" : n.seconds > min60End ? "结尾-120fps结束早晚收" : "中间-帧边界";
                console.log(`  120only: idx=${idx} ${n.seconds.toFixed(3)}s ${posLabel}`);
            }
        }
    }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`技能排队偏移分析  (FINISH_GAP=${FINISH_GAP.toFixed(3)}s, fps=${FPS}, 阈值=${OVERLAP_THRESHOLD.toFixed(3)}s)`);
console.log("=".repeat(60));

if (results.length === 0) {
    console.log("\n未发现任何需要排队偏移修正的谱面。");
} else {
    // 按重叠位置数降序排列（多个重叠位置的最有趣）
    results.sort((a, b) => Object.keys(b.overlaps).length - Object.keys(a.overlaps).length);

    for (const r of results) {
        const overlapPositions = Object.keys(r.overlaps).map(Number).sort();

        console.log(`\n[song=${r.songId}] [${r.difficulty}] 排队位置: ${overlapPositions.join(", ")}`);

        // 输出技能触发时间线
        for (let i = 0; i < r.skillEvents.length; i++) {
            const e = r.skillEvents[i];
            const gap = i > 0 ? (e.seconds - r.skillEvents[i - 1].seconds).toFixed(2) : "-";
            const marker = overlapPositions.includes(i) ? " ← queued" : "";
            console.log(`  #${i}: beat=${e.beat.toFixed(2).padStart(8)} time=${e.seconds.toFixed(2).padStart(7)}s gap=${gap.padStart(6)}s${marker}`);
        }

        // 输出每个排队位置的 shifts 表
        for (const pos of overlapPositions) {
            const shifts = r.overlaps[pos];
            const prevDurations = Object.keys(shifts).sort((a, b) => Number(a) - Number(b));

            console.log(`\n  位置 ${pos} shifts[d_prev][d_cur]:`);

            // 收集所有出现过的 d_cur
            const allCurDurs = new Set<string>();
            for (const pd of prevDurations) {
                for (const cd of Object.keys(shifts[pd])) {
                    allCurDurs.add(cd);
                }
            }
            const curDurs = [...allCurDurs].sort((a, b) => Number(a) - Number(b));

            // 表头
            const header = `    d_prev\\d_cur ${curDurs.map((d) => d.padStart(5)).join("")}`;
            console.log(header);
            console.log(`    ${"-".repeat(header.length - 4)}`);

            // 表体
            for (const pd of prevDurations) {
                const row = curDurs
                    .map((cd) => {
                        const val = shifts[pd]?.[cd];
                        if (val === undefined) return "     ";
                        const sign = val > 0 ? "+" : "";
                        return `${sign}${val}`.padStart(5);
                    })
                    .join("");
                console.log(`    ${pd.padStart(5)}  ${row}`);
            }
        }
    }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`总谱面数: ${totalCharts}`);
console.log(`需要排队偏移修正的谱面数: ${results.length}`);
console.log(`${"=".repeat(60)}`);
