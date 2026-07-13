// noinspection DuplicatedCode
/**
 * 技能帧计数模型研究
 *
 * 研究目标：
 * 1. 验证 ceil(t * fps) 帧计数模型正确性
 * 2. 对比 60fps vs 120fps 覆盖差异
 * 3. 验证 delta 编码方案（diff 范围 0-9）
 * 4. 交叉验证 fumeinn-verification 数据
 *
 * 运行: npx ts-node -r tsconfig-paths/register src/test/research-skill-frame-model.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================
// 类型 (复制自 BestdoriChartParser)
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
type Chart = ChartItem[];

interface BeatEvent {
    beat: number;
    seconds: number;
}

interface NormalizedChart {
    total: number;
    noteEvents: BeatEvent[];
    skillEvents: BeatEvent[];
}

// ============================================================
// 常量
// ============================================================

const SKILL_DURATION_SECONDS = Array.from({ length: 51 }, (_, i) => (30 + i) / 10);
const TARGET_SKILL_COUNT = 6;
const DEFAULT_BPM = 120;

// ============================================================
// 工具函数 (复制自 BestdoriChartParser)
// ============================================================

function extractBpmList(chart: Chart): Array<{ beat: number; bpm: number; seconds: number }> {
    const bpmEvents = chart
        .filter((item): item is BPMEvent => item.type === "BPM")
        .slice()
        .sort((a, b) => a.beat - b.beat || a.bpm - b.bpm);

    if (bpmEvents.length === 0) {
        return [{ beat: 0, bpm: DEFAULT_BPM, seconds: 0 }];
    }

    const timeline: Array<{ beat: number; bpm: number; seconds: number }> = [];
    let currentSeconds = 0;
    let currentBeat = bpmEvents[0].beat;
    let currentBpm = bpmEvents[0].bpm > 0 ? bpmEvents[0].bpm : DEFAULT_BPM;

    timeline.push({ beat: currentBeat, bpm: currentBpm, seconds: currentSeconds });

    for (let index = 1; index < bpmEvents.length; index += 1) {
        const nextBeat = bpmEvents[index].beat;
        const nextBpm = bpmEvents[index].bpm > 0 ? bpmEvents[index].bpm : DEFAULT_BPM;
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

function beatToSeconds(beat: number, timeline: Array<{ beat: number; bpm: number; seconds: number }>): number {
    let selected = timeline[0];
    for (const point of timeline) {
        if (point.beat <= beat) {
            selected = point;
        } else {
            break;
        }
    }
    return selected.seconds + ((beat - selected.beat) * 60) / selected.bpm;
}

function extractSkillEvents(item: ChartItem, timeline: Array<{ beat: number; bpm: number; seconds: number }>): BeatEvent[] {
    if (item.type === "Single") {
        return item.skill ? [{ beat: item.beat, seconds: beatToSeconds(item.beat, timeline) }] : [];
    }
    if (item.type === "Long" || item.type === "Slide") {
        const points = (item as ConnectionNote).connections || [];
        return points.filter((p) => p.skill).map((p) => ({ beat: p.beat, seconds: beatToSeconds(p.beat, timeline) }));
    }
    return [];
}

function extractNoteEvents(item: ChartItem, timeline: Array<{ beat: number; bpm: number; seconds: number }>): BeatEvent[] {
    switch (item.type) {
        case "Single":
            return item.skill ? [] : [{ beat: item.beat, seconds: beatToSeconds(item.beat, timeline) }];
        case "Directional":
            return [{ beat: item.beat, seconds: beatToSeconds(item.beat, timeline) }];
        case "Long":
        case "Slide":
            return (item as ConnectionNote).connections
                .filter((point) => !point.hidden && !point.skill)
                .map((point) => ({ beat: point.beat, seconds: beatToSeconds(point.beat, timeline) }));
        default:
            return [];
    }
}

function normalizeChart(chart: Chart): NormalizedChart {
    const timeline = extractBpmList(chart);

    let skillEvents = chart.flatMap((item) => extractSkillEvents(item, timeline)).sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);

    // 同一 beat 的多技能点去重（big-keys / 多轨技能）
    const deduped: BeatEvent[] = [];
    const EPS = 1e-6;
    for (const se of skillEvents) {
        if (deduped.length === 0) {
            deduped.push(se);
            continue;
        }
        const prev = deduped[deduped.length - 1];
        if (Math.abs(prev.beat - se.beat) <= EPS) {
            continue;
        }
        deduped.push(se);
    }
    skillEvents = deduped;

    const noteEvents = chart.flatMap((item) => extractNoteEvents(item, timeline)).sort((a, b) => a.beat - b.beat || a.seconds - b.seconds);

    return {
        total: skillEvents.length + noteEvents.length,
        noteEvents,
        skillEvents,
    };
}

// ============================================================
// 帧计数模型
// ============================================================

/**
 * 计算单个技能窗口在指定 fps 下覆盖的 note 数量。
 *
 * 帧模型:
 *   F_s   = ceil(skillTime * fps)           // 触发帧（本帧无加成）
 *   F_end = F_s + ⌈duration * fps⌉ + 1      // dur*fps 次递减 + 1 帧结束红利
 *                                           // 实现: ceil(duration*fps - 1e-9) 防浮点误差
 *   note 受加成 ⇔  ceil(noteTime * fps) ∈ (F_s, F_end]
 */
function countNotesInSkillWindow(noteEvents: BeatEvent[], skillTime: number, durationSec: number, fps: number): number {
    const F_s = Math.ceil(skillTime * fps);
    const FPS_EPSILON = 1e-9;
    const F_end = F_s + Math.ceil(durationSec * fps - FPS_EPSILON) + 1;

    let count = 0;
    for (const note of noteEvents) {
        // 技能触发时刻之前的 note 不算
        if (note.seconds <= skillTime) {
            continue;
        }
        const F_n = Math.ceil(note.seconds * fps);
        if (F_n > F_s && F_n <= F_end) {
            count++;
        } else if (F_n > F_end) {
            // noteEvents 按时序排列，后续都超出窗口
            break;
        }
    }
    return count;
}

/**
 * 构建指定 fps 下的 counts 矩阵。
 * 返回: durationIndex -> [skill0覆盖数, skill1覆盖数, ..., skill5覆盖数]
 */
function buildCountsFps(normalized: NormalizedChart, fps: number): number[][] {
    const { noteEvents, skillEvents } = normalized;

    if (skillEvents.length !== TARGET_SKILL_COUNT) {
        throw new Error(`Expected ${TARGET_SKILL_COUNT} skill events, got ${skillEvents.length}`);
    }

    return SKILL_DURATION_SECONDS.map((durationSec) =>
        skillEvents.map((skillEvent) => countNotesInSkillWindow(noteEvents, skillEvent.seconds, durationSec, fps)),
    );
}

/**
 * 旧模型: 纯时间窗口（当前 BestdoriChartParser.buildCounts 的逻辑）
 */
function buildCountsTimeWindow(normalized: NormalizedChart): number[][] {
    const { noteEvents, skillEvents } = normalized;

    if (skillEvents.length !== TARGET_SKILL_COUNT) {
        throw new Error(`Expected ${TARGET_SKILL_COUNT} skill events, got ${skillEvents.length}`);
    }

    return SKILL_DURATION_SECONDS.map((windowSeconds) =>
        skillEvents.map((skillEvent) => {
            const windowEnd = skillEvent.seconds + windowSeconds;
            let count = 0;
            for (const note of noteEvents) {
                if (note.seconds <= skillEvent.seconds) continue;
                if (note.seconds > windowEnd) break;
                count++;
            }
            return count;
        }),
    );
}

// ============================================================
// 4 位二进制编码 (零浮点精度损失)
// ============================================================
//
// 4 位: smmm (s=符号位, mmm=数量 0-7)
//   二进制值 v ∈ [0, 15]
//   编码值 = base + v/16
//   v/16 是 2 的幂分母，IEEE 754 精确表示
//
// 例如: diff=+3 → 0011=3 → base + 3/16 = base + 0.1875
//       diff=-2 → 1010=10 → base + 10/16 = base + 0.625
//       diff=0  → 0000=0 → base (整数)

const ENCODE_DENOM = 16;

function encodeCount(base: number, diff: number): number {
    if (diff === 0) return base; // 干净整数
    const signBit = diff > 0 ? 0 : 1;
    const magnitude = Math.abs(diff);
    const binaryValue = (signBit << 3) | magnitude; // smmm
    return base + binaryValue / ENCODE_DENOM;
}

function decodeCount(value: number): { base: number; diff: number } {
    const base = Math.floor(value);
    const binaryValue = Math.round((value - base) * ENCODE_DENOM);
    const sign = (binaryValue >> 3) & 1;
    const magnitude = binaryValue & 0b0111;
    const diff = sign === 0 ? magnitude : -magnitude;
    return { base, diff };
}

// ============================================================
// 验证: fumeinn-verification 交叉验证
// ============================================================

/**
 * 验证 note#385 (beat 303.5, BPM=185) 在 skill#5 (beat 288, duration 5.0s) 下的行为。
 * 来自 fumeinn-verification.md:
 *   - 60fps: note#385 判定帧=5906, skill#5结束帧=5906, 有加成 ✓
 *   - 120fps: note#385 判定帧=11812, skill#5结束帧=11810, 无加成 ✓
 */
function verifyFumeinnData(): boolean {
    const BPM = 185;
    const duration = 5.0;
    const skillBeat = 288;
    const noteBeat = 303.5;

    const skillTime = (skillBeat * 60) / BPM;
    const noteTime = (noteBeat * 60) / BPM;

    const noteEvent: BeatEvent = { beat: noteBeat, seconds: noteTime };

    const ok60 = countNotesInSkillWindow([noteEvent], skillTime, duration, 60) === 1;
    const ok120 = countNotesInSkillWindow([noteEvent], skillTime, duration, 120) === 0;

    console.log("=== 交叉验证: fumeinn-verification note#385 ===\n");
    console.log(`  技能beat=${skillBeat}, 时间=${skillTime.toFixed(4)}s`);
    console.log(`  Note beat=${noteBeat}, 时间=${noteTime.toFixed(4)}s`);
    console.log(`  Duration=${duration}s, BPM=${BPM}`);

    for (const fps of [60, 120]) {
        const F_skill = Math.ceil(skillTime * fps);
        const F_end = F_skill + Math.ceil(duration * fps - 1e-9) + 1;
        const F_note = Math.ceil(noteTime * fps);
        const getsBonus = F_note > F_skill && F_note <= F_end;
        console.log(
            `  ${fps}fps: F_s=${F_skill}, F_end=${F_end}, F_note=${F_note}, bonus=${getsBonus ? "有" : "无"} ${fps === 60 ? "(期望: 有)" : "(期望: 无)"}`,
        );
    }

    console.log(`\n  60fps: ${ok60 ? "✓ 吻合" : "✗ 不符"}`);
    console.log(`  120fps: ${ok120 ? "✓ 吻合" : "✗ 不符"}`);

    return ok60 && ok120;
}

// ============================================================
// 主流程
// ============================================================

function printMatrix(label: string, matrix: number[][]) {
    console.log(`  ${label}`);
    for (let i = 0; i < matrix.length; i++) {
        const duration = SKILL_DURATION_SECONDS[i].toFixed(1);
        console.log(`    ${duration.padStart(4, " ")}s  [${matrix[i].map((v) => String(v).padStart(2, " ")).join(", ")}]`);
    }
}

/**
 * 打印差值矩阵: to - from
 * 返回 [最小差, 最大差]
 */
function printDiffMatrix(label: string, from: number[][], to: number[][]): { fromMin: number; fromMax: number } {
    console.log(`  ${label}`);
    let fromMin = 0;
    let fromMax = 0;
    for (let i = 0; i < to.length; i++) {
        const duration = SKILL_DURATION_SECONDS[i].toFixed(1);
        const diffs = to[i].map((v, j) => v - from[i][j]);
        fromMin = Math.min(fromMin, ...diffs);
        fromMax = Math.max(fromMax, ...diffs);
        const diffStr = diffs.map((d) => {
            const sign = d >= 0 ? "+" : "";
            return `${sign}${d}`;
        });
        console.log(`    ${duration.padStart(4, " ")}s  [${diffStr.map((s) => s.padStart(3, " ")).join(", ")}]`);
    }
    return { fromMin, fromMax };
}

function printEncodedMatrix(matrix120: number[][], matrix60: number[][]) {
    console.log("  Encoded (4-bit binary: smmm/16)");
    const issues: string[] = [];
    for (let i = 0; i < matrix120.length; i++) {
        const duration = SKILL_DURATION_SECONDS[i].toFixed(1);
        const encoded = matrix120[i].map((base, j) => {
            const diff = matrix60[i][j] - base;
            if (Math.abs(diff) > 7) {
                issues.push(`  [${duration}s, S${j}] diff=${diff} > 7!`);
            }
            return encodeCount(base, diff);
        });
        console.log(`    ${duration.padStart(4, " ")}s  [${encoded.map((s) => String(s).padStart(9, " ")).join(", ")}]`);
    }
    if (issues.length > 0) {
        console.log("\n  ⚠  diff 超限:");
        for (const issue of issues) console.log(issue);
    }
}

function verifyEncoding(matrix120: number[][], matrix60: number[][]) {
    let ok = true;
    for (let i = 0; i < matrix120.length; i++) {
        for (let j = 0; j < matrix120[i].length; j++) {
            const encoded = encodeCount(matrix120[i][j], matrix60[i][j] - matrix120[i][j]);
            const decoded = decodeCount(encoded);
            if (decoded.base !== matrix120[i][j] || decoded.diff !== matrix60[i][j] - matrix120[i][j]) {
                console.log(
                    `  ✗ 编码验证失败: (base=${matrix120[i][j]}, diff=${matrix60[i][j] - matrix120[i][j]}) → ${encoded} → (base=${decoded.base}, diff=${decoded.diff})`,
                );
                ok = false;
            }
        }
    }
    console.log(`\n  编码可逆性验证: ${ok ? "✓ 全部通过" : "✗ 存在失败"}`);
    return ok;
}

function main() {
    const songId = process.argv[2] || "1";
    const difficulty = process.argv[3] || "expert";

    // 读取本地 chart 数据
    const chartPath = join(__dirname, "..", "..", "data", "raw", "charts", songId, `${difficulty}.json`);
    console.log(`Chart: songId=${songId} (${difficulty}), path=${chartPath}`);
    const raw = readFileSync(chartPath, "utf-8");
    const chart: Chart = JSON.parse(raw);
    console.log(`Chart items=${chart.length}`);

    const normalized = normalizeChart(chart);
    console.log(`Normalized: total=${normalized.total}, noteEvents=${normalized.noteEvents.length}, skillEvents=${normalized.skillEvents.length}\n`);

    // 1. 交叉验证（仅曲1 expert 有意义，数据来自 fumeinn-verification）
    const skipCrossCheck = songId !== "1" || difficulty !== "expert";
    let fumeinnOk = true;
    if (skipCrossCheck) {
        console.log("=== 交叉验证: 跳过 (仅适用于 songId=1 expert) ===\n");
    } else {
        fumeinnOk = verifyFumeinnData();
        console.log();
    }

    // 2. 旧模型 (纯时间窗口，与帧率无关)
    console.log("=== 旧模型 (纯时间窗口) ===");
    const oldCounts = buildCountsTimeWindow(normalized);
    printMatrix("任意fps", oldCounts);
    console.log();

    // 3. 新模型 (帧计数)
    console.log("=== 新模型 (帧计数) ===");
    const counts120 = buildCountsFps(normalized, 120);
    const counts60 = buildCountsFps(normalized, 60);
    printMatrix("120fps", counts120);
    console.log();
    printMatrix("60fps", counts60);
    console.log();

    // 4. 新旧模型对比 (120fps) — 新模型应该 ≥ 旧模型（多了 +1/fps 结束帧红利）
    console.log("=== 新旧模型差异 (120fps) ===");
    const { fromMin: minOldNew, fromMax: maxOldNew } = printDiffMatrix("新模型 - 旧模型", oldCounts, counts120);
    console.log(`\n  差异范围: [${minOldNew}, ${maxOldNew}]`);
    console.log();

    // 5. 60fps vs 120fps diff — 60fps 窗口更大，diff 应 ≥ 0
    console.log("=== 60fps vs 120fps Diff ===");
    const { fromMin: minDiff, fromMax: maxDiff } = printDiffMatrix("60fps - 120fps", counts120, counts60);
    console.log(`\n  diff 范围: [${minDiff}, ${maxDiff}]`);
    const withinLimit = maxDiff <= 7 && minDiff >= -7;
    console.log(`  diff 在 [-7, 7] 范围内 (4-bit binary): ${withinLimit ? "✓" : "✗"}  max=${maxDiff}, min=${minDiff}`);
    console.log();

    // 6. 编码矩阵
    console.log("=== Delta 编码矩阵 ===");
    printEncodedMatrix(counts120, counts60);
    console.log();

    // 7. 编码可逆性验证
    console.log("=== 编码验证 ===");
    verifyEncoding(counts120, counts60);

    // 总结
    console.log("\n=== 结论 ===");
    if (!skipCrossCheck) {
        console.log(`  交叉验证: ${fumeinnOk ? "✓ 通过" : "✗ 失败"}`);
    }
    console.log(`  新旧模型(120fps)差异范围: [${minOldNew}, ${maxOldNew}]`);
    console.log(`  60fps-120fps diff 范围: [${minDiff}, ${maxDiff}]`);
    console.log(`  diff 编码可行: ${withinLimit ? "✓ (全部在 -7~7, 4-bit binary)" : "✗ (存在超限)"}`);
}

main();
