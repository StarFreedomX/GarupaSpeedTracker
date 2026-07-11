# BanG Dream! 自动打歌技能系统 — 静态分析报告 v2

> 分析目标：`libil2cpp.so`（BanG Dream! v9.4.1，IL2CPP v31，ARM64）
> 方法：IDA Pro 反编译，`global-metadata.dat` 元数据解析，Il2CppDumper 交叉验证
> 日期：2026-07-10

游戏逻辑跑在 Unity 的 `Update()` 回调中。`Update()` 的调用频率跟随 VSync，实际判定频率取决于屏幕刷新率。

**游戏进度和技能 timer 都在 `Update()` 里跑，和渲染共用一线程，因此游戏判定帧率即为设置设定的fps值。deltaTime 在60FPS时为1/60，在120FPS时为1/120，deltaTime最大值为1/60**

---

游戏每帧检查哪些 note 的 `absolutePos` 已被 `MusicPos` 越过。技能的行为按时间顺序分为四个阶段（以auto为例）：

- **触发帧**（1 帧）：本帧 `NoteManager.Update`（先执行）中，技能 note 过判定线 → `forcePerfect` 将技能数据写入 `playList` 并触发状态切换为 Begin。随后 `ExecUpdate`（后执行）Case 1 从 `playList` 弹出数据，设置 `skillTimer = duration`，状态切换为 Playing。**判定时技能指针仍为 null，因此本帧内所有 note 均无技能加成，不递减。**
- **递减帧**（帧数由 `timer > 0` 逐帧决定）：触发帧的下一帧开始。每帧 `NoteManager.Update` 先判定（此时 `currentPlayingSkillData` 非 null → 享受加成），然后 `ExecUpdate` Case 2 先判断 `timer > 0` → 通过 → 执行 `timer -= deltaTime`。共递减 420 次后 timer ≈ 0。
- **结束帧**（1 帧）：timer ≈ 0 的那一帧。`NoteManager.Update` 先判定——此时 `currentPlayingSkillData` 仍非 null（前一帧只递减未调 `FinishSkill`）→ **最后一次加成**。随后 `ExecUpdate` Case 2 检测 `timer ≤ 0` → `FinishSkill` → `currentPlayingSkillData = null`，状态切换为 Finishing。**本帧case2进入结束技能分支，不进行递减。**
- **普通帧**（此后所有帧）：`currentPlayingSkillData == null`，note 不再携带技能倍率。

---

## 1. 位置系统

### 1.1 absolutePos

`NoteInformation` 的实例字段 `absolutePos` 位于偏移 `0x40`。

构造函数 `NoteInformation..ctor()` 在 `0x2B24694`：

```c
// a3[0]=barIndex, a3[1]=numerator, a3[2]=denominator
// CONSTANT = NoteManager.MUSIC_BAR_DIVISION_COUNT，通过 off_64EA430[23] 读取
absolutePos = numerator * CONSTANT / denominator + CONSTANT * barIndex;
```

对应汇编（`0x2B24810`）：

```asm
LDR   X8, [X0,#0xB8]    ; off_64EA430 基址
LDR   W8, [X8]           ; CONSTANT (int32)
MUL   W15, W12, W8       ; numerator * CONSTANT
SDIV  W15, W15, W13      ; / denominator
MADD  W15, W8, W11, W15  ; + CONSTANT * barIndex
STR   W15, [X1,#0x40]    ; this->absolutePos
```

### 1.2 GetBarSeconds

`NoteUtility.GetBarSeconds()`，`0x2C013EC`：

```c
float GetBarSeconds(float bpm) {
    return 240.0f / bpm;
}
```

汇编即 `0x2C01440` 处的 `FDIV S0, 240.0, S0`。

### 1.3 GetSecWithDistance

`NoteUtility.GetSecWithDistance()`，`0x2C00ED8`：

```c
float GetSecWithDistance(float distance, float bpm) {
    float barSec = GetBarSeconds(bpm);
    return (barSec * distance) / (float)CONSTANT;
}
```

---

## 2. 音符判定

### 2.1 MoveState

`NoteSingleBase.MoveState()`，`0x2FC0F78`：

```c
void MoveState(NoteSingleBase* this, float deltaTime) {
    UpdateBase(this, deltaTime);
    float MusicPos = GetAdjustMusicPos(noteManager);
    float notePos = (float)noteInfo->absolutePos;

    if (MusicPos >= notePos) {
        this->accumulatedTime += deltaTime;

        if (IsAutoPlay())
            forcePerfect();                    // vtable[89]
        else if (gameState == 14)
            forcePerfect();                    // vtable[89]
        else if (this->accumulatedTime > TIMEOUT)
            ChangeState(Wait/Stop);            // vtable[87]
    } else {
        this->accumulatedTime = 0;
    }
}
```

> **技能 note 特化**：当 `forcePerfect`（vtable[89]）作用于技能 note 时，其子类实现除写入 `playList` 外，还会调用 `sub_3352370`（`0x3352370`）→ `changeState(1)`，将 `skillPlayState` 设为 Begin，使得同帧后续的 `ExecUpdate` 进入 Case 1 处理队列。

核心指令：

| 地址          | 指令                       | 说明                        |
|-------------|--------------------------|---------------------------|
| `0x2FC1020` | `FSUB S0,S9,S0`          | MusicPos - notePos        |
| `0x2FC1024` | `FCMP S0,#0.0`           |                           |
| `0x2FC1028` | `B.GE loc_2FC1038`       | 非严格大于等于即触发                |
| `0x2FC1044` | `STR S0,[X19,#0x14C]`    | accumulatedTime 在偏移 0x14C |
| `0x2FC1050` | `BL sub_3320E88`         | IsAutoPlay                |
| `0x2FC1054` | `TBNZ W0,#0,loc_2FC1078` | 自动模式直接 forcePerfect       |

---

## 3. 技能系统

### 3.1 结构

| 偏移     | 字段                           | 类型                                             |
|--------|------------------------------|------------------------------------------------|
| `0x70` | `situationSkillDataPlayList` | `List<SituationSkillData>`                     |
| `0x80` | `currentPlayingSkillData`    | `SituationSkillData*`                          |
| `0x88` | `skillTimer`                 | `float`                                        |
| `0x8C` | `skillFinishingTimer`        | `float`                                        |
| `0x90` | `skillPlayState`             | `int`（0=Idle, 1=Begin, 2=Playing, 3=Finishing） |

`SituationSkillMaster.duration` 位于偏移 `0x30`，float 类型，服务器下发。

### 3.2 processOfSkillTriggered

`0x3352C50`：

```c
void processOfSkillTriggered(SituationSkillManager* this, uint frameCounter) {
    SituationSkillData* data = this->currentPlayingSkillData;   // 0x80
    SituationSkillMaster* skill = data->skill;                   // 0x18
    this->skillTimer = skill->duration;                          // 0x88 = skill+0x30
}
```

### 3.3 ExecUpdate

`0x3351C64`，每帧调用一次。Switch 基于 `this->skillPlayState`（偏移 `0x90`）：

```asm
3351cb4: LDR   W8, [X20,#0x90]       ; state = this->skillPlayState
3351cbc: CMP   W8, #3                ; case 3: Finishing
3351cc4: CMP   W8, #2                ; case 2: Playing
3351ccc: CMP   W8, #1                ; case 1: Begin
                                      ; default → return (Idle)
```

对应 C 伪代码：

```c
// void ExecUpdate(SituationSkillManager* this, uint frameCounter, int gameState)
switch (this->skillPlayState) {

    // Case 1: Begin（由 forcePerfect 触发：forcePerfect → sub_3352370 → changeState(1)）
    case 1: {
        if (this->playList.Count > 0) {                // [this + 0x70]
            // 从队列弹出
            this->currentPlayingSkillData = DequeueFromPlayList();  // [this + 0x80]
            processOfSkillTriggered(frameCounter);      // 设置 skillTimer = duration
            changeState(2);                             // → Playing
        } else {
            // 队列为空（不应发生）
            this->currentPlayingSkillData = null;
            changeState(0);                             // → Idle
        }
        return;
    }

    // Case 2: Playing（递减帧 / 结束帧）
    case 2: {
        float timer = this->skillTimer;                 // [this + 0x88]

        if (timer <= 0.0f) {
            // --- 结束帧: timer 耗尽，FinishSkill ---
            FinishSkill();                              // currentPlayingSkillData = null
            changeState(3);                             // → Finishing
            this->finishingTimer = 0.75f;               // [this + 0x8C]
            return;
        }

        // timer > 0: 游戏暂停时不递减
        if (gameState == 7 || gameState == 8)
            return;

        // --- 递减帧: 执行一次递减 ---
        this->skillTimer -= Time.deltaTime;
        UpdateSkillEffectiveTimer();
        return;
    }

    // Case 3: Finishing（结束动画）
    case 3: {
        float t = this->finishingTimer;                 // [this + 0x8C]

        if (t > 0.0f) {
            this->finishingTimer -= Time.deltaTime;     // 动画倒计时
            return;
        }

        // 动画结束
        changeState(0);                                 // → Idle

        // 如果有排队中的技能，直接进入 Begin
        if (this->playList != null && this->playList.Count >= 1) {
            changeState(1);                             // → Begin（下一帧处理）
        } else {
            this->currentPlayingSkillData = null;       // 确保清空
        }
        return;
    }

    // Case 0: Idle（默认）
    default:
        return;  // 无事发生
}
```

Case 2 相关汇编：

```asm
; --- Case 2 Playing ---
3351e78: LDR   S8, [X19,#0x88]       ; S8 = skillTimer
3351e7c: FCMP  S8, #0.0              ; timer <= 0 ?
3351e80: B.LE  finish_branch          ; 是 → FinishSkill

; timer > 0
3351e84: SUB   W8, W20, #7            ; gameState - 7
3351e88: CMP   W8, #2
3351e8c: B.CC  paused_return          ; gameState 7/8 → 跳过递减
3351e90: MOV   X0, XZR
3351e94: BL    sub_5D351DC            ; ← Time.get_deltaTime()
3351e98: FSUB  S0, S8, S0             ; timer -= deltaTime
3351e9c: STR   S0, [X19,#0x88]        ; 写回 skillTimer
3351eac: B     loc_334E81C            ; → UpdateSkillEffectiveTimer

; finish_branch
3351eb0: MOV   X0, X19
3351eb4: BL    sub_335302C            ; FinishSkill()
3351ebc: MOV   X0, X19
3351ec0: BL    sub_3352980            ; changeState(3) = Finishing
3351ec4: MOV   W8, #0x3F400000        ; 0.75f
3351ec8: STR   W8, [X19,#0x8C]        ; finishingTimer = 0.75f
```

**case2细节**：

- `0x3351E94`：`BL sub_5D351DC` → `UnityEngine.Time::get_deltaTime()` — **游戏运行的每帧间隔**
- `0x3351E7C-80`：timer 判断（`FCMP; B.LE`）在递减（`FSUB`，`0x3351E98`）**之前
- gameState 为 7 或 8 时跳过递减

### 3.4 判定阶段的技能状态读取

`sub_2FC09C8` 中通过 `get_CurrentPlayingSkillData()`（`0x3351718`）获取技能数据：

```c
// 0x3351750: 简单返回 *(this + 0x80)，不做状态判断
SituationSkillData* data = *(SituationSkillData**)(situationSkillManager + 0x80);
```

**技能加成通过 `currentPlayingSkillData` 是否非 null 来判断。**

`currentPlayingSkillData` 的生命周期：

| 事件                    | 操作                                      | 地址                                 |
|-----------------------|-----------------------------------------|------------------------------------|
| `forcePerfect` 触发状态切换 | 写入 playList 并调 `changeState(1)` → Begin | `0x3352370` → `0x3352520`          |
| 技能激活（case 1）          | 从 playList 弹出并赋值                        | `0x3351DB4`                        |
| 技能终止（FinishSkill）     | 置为 null                                 | `0x335302C` 中 `*(this + 0x80) = 0` |
| 结束动画结束                | 置为 null（无排队时）                           | `0x3351FAC`                        |

---

## 4. MusicPos 与推演

### 4.1 get_MusicPos

`InGameMusicScoreController.get_MusicPos()`，`0x332E600`：

```c
float get_MusicPos(InGameMusicScoreController* this) {
    int beatProgress = *(int*)(this + 0x44);       // musicBarProgress
    float basePos = *(float*)(this + 0x48);         // musicBeatProgress
    int CONSTANT = *(int*)off_64EA430[23];          // MUSIC_BAR_DIVISION_COUNT
    return basePos + (float)(CONSTANT * beatProgress);
}
```

### 4.2 UpdateMusicScoreProgress

`0x332E9FC`：每帧被 `NoteManager.Update`（`0x2B2A638`）调用。

MusicPos 推进使用传入的 deltaTime（即 `Time.deltaTime`）：

```c
musicBeatProgress += deltaTime / (GetBarSeconds(bpm) / CONSTANT)
                  = deltaTime * CONSTANT * BPM / 240.0
```

### 4.3 帧内调用顺序

`updatePlayState`（`0x33E4F70`）中：

```c
void updatePlayState(float deltaTime) {
    IncrementGameFrameCounter();          // 0x33E5024
    updatePlayingSound();                 // 0x33E5058
    sub_33E8FF8();                        // 0x33E5098

    if (canThroughInputInspection) {      // 0x33E50C4

        NoteManager.Update(deltaTime);    // 0x33E50DC
        //   → UpdateMusicScoreProgress  → MoveState → 判定
        //   ↑ 此时 currentPlayingSkillData 来自上一帧 ExecUpdate

        ExecUpdate(frameCounter, gameState); // 0x33E512C
        //   → Case 2 → timer 检查 → 递减或 FinishSkill
        //   ↑ 本帧判定已做完，这里才更新 timer
    }
}
```

**NoteManager.Update 在 ExecUpdate 之前运行。** note 判定使用的是**上一帧 ExecUpdate 结束时**的技能状态。

### 4.4 CONSTANT 消去

```
判定条件：MusicPos >= absolutePos

  F * BPM * CONSTANT / 14400 >= bar * CONSTANT + num * CONSTANT / den
  F * BPM >= (bar + num/den) * 14400
  F >= beat * 3600 / BPM

判定帧 = ceil(beat * 3600 / BPM)
```

CONSTANT 不出现在结果中。

### 4.5 推演（BPM=137&60FPS示例，忽略因为设备导致的偏移）

| beat | 帧(float) | 判定帧  |
|------|----------|------|
| 16   | 420.44   | 421  |
| 44   | 1156.20  | 1157 |
| 60   | 1576.64  | 1577 |
| 76   | 1997.08  | 1998 |
| 92   | 2417.52  | 2418 |
| 148  | 3889.05  | 3890 |
| 164  | 4309.49  | 4310 |
| 180  | 4729.93  | 4730 |
| 196  | 5150.36  | 5151 |
| 212  | 5570.80  | 5571 |
| 228  | 5991.24  | 5992 |

以 7.0s（420 次递减 @60fps）duration 为例，技能时序（四个阶段：触发帧 → 递减帧 → 结束帧 → 普通帧）：

| # | 技能beat | 触发帧  | 递减帧区间       | 结束帧  | 边界beat | 边界判定 | 加成 |
|---|--------|------|-------------|------|--------|------|----|
| 1 | 16     | 421  | 422 ~ 841   | 842  | —      | —    | —  |
| 2 | 44     | 1157 | 1158 ~ 1577 | 1578 | 60     | 1577 | 有  |
| 3 | 76     | 1998 | 1999 ~ 2418 | 2419 | 92     | 2418 | 有  |
| 4 | 148    | 3890 | 3891 ~ 4310 | 4311 | 164    | 4310 | 有  |
| 5 | 180    | 4730 | 4731 ~ 5150 | 5151 | 196    | 5151 | 有  |
| 6 | 212    | 5571 | 5572 ~ 5991 | 5992 | 228    | 5992 | 有  |

边界 note（#5 的 5151、#6 的 5992）的判定帧恰好为结束帧——`NoteManager.Update` 先判定（`currentPlayingSkillData` 仍非 null → 吃加成），随后 `ExecUpdate` 才检测 `timer ≤ 0` 并执行 `FinishSkill` 置 null。判定在前，置 null 在后，因此结束帧内判定的 note 仍享受加成。

---

## 5. NoteManager.Update 的子帧分割

`NoteManager.Update`（`0x2B2A410`）由 `updatePlayState` 无条件调用，不区分自动/手动模式。

丢帧时 `Time.deltaTime` 变大。子帧分割把大 dt 切成 n4 小段，每段用 `dt/n4` 推进 MusicPos、更新 note 位置、判定一次。全在同一轮 `Update()` 内跑完才渲染，中间状态不可见。分割触发条件：

| dt 范围   |   n4   |
|---------|:------:|
| < 18ms  | 1（不分割） |
| 18~33ms |   2    |
| 33~50ms |   3    |
| ≥ 50ms  |   4    |

所有子帧共享同一个来自上一帧 ExecUpdate 的 `currentPlayingSkillData`，因此理论上在结束帧的时候卡一下可以延长技能（不过精准卡在那帧概率有点小了）。

---

## 6. 屏幕刷新率对技能区间的影响

### 6.1 timer 递减用的是 `Time.deltaTime`

```asm
3351e94: BL    sub_5D351DC          ; ← UnityEngine.Time::get_deltaTime()
3351e98: FSUB  S0, S8, S0           ; timer -= deltaTime
3351e9c: STR   S0, [X19,#0x88]       ; 写回 skillTimer
```

`sub_5D351DC` 反编译：

```c
return ((__int64 (*)(void))off_67B1F50)();  // Time.get_deltaTime()
```

### 6.2 技能区间

#### 6.2.1 技能区间固定长度

由上面的分析可以得到，timer 在递减 duration * fps 次后 ≈ 0，但结束帧的判定发生在 FinishSkill 之前，pointer 仍非 null，多给了一帧加成。因此实际加成帧数 = 递减次数 + 1。

则理论上技能覆盖的帧数和宽度为：

| 帧率     | 技能生效帧(递减帧+结束帧) | 覆盖时长     |
|:-------|----------------|----------|
| 60FPS  | 420+1=421帧     | 7.01667s |
| 120FPS | 840+1=841帧     | 7.00833s |

#### 6.2.2 不稳定区间（最长技能距离）

> 本节内容为作者对SOS 7s技能测试的个人猜想，尚未进行充分性验证

技能的实际生效窗口不是由"timer = 7.0s"这一个数字决定的，而是由两个独立因素共同塑造。

**因素一：offset_skill。** 技能 note 的 `ceil` 判定引入了 `offset_skill ∈ [0, 1/fps)`——即 note 实际过线时刻到判定帧之间的余量。offset 越大，判定越"晚"，整个技能周期随之右移。

**因素二：结束帧的额外加成。** timer 在递减 420 次后 ≈ 0，但结束帧的判定发生在 FinishSkill 之前，pointer 仍非 null，多给了一帧加成。因此实际加成帧数 = 递减次数 + 1。

结合两者，技能覆盖窗口的结束边界为：

```
结束边界 = offset_skill + (递减帧数 + 1) / fps
        = offset_skill + 421 / fps     (60fps 时)
        = offset_skill + 841 / fps     (120fps 时)
```

**offset_skill 理论上对特定的键而言为一固定值**，但由于 deltaTime 跑在Unity事件循环中，其帧率会受到设备等的影响而不稳定，导致在 [0, 1/fps) 内浮动，意味着覆盖终点不是定值，而是一个**开区间**：

|   帧率   | offset 范围    | 递减总时间 | 覆盖终点可能区间             |
|:------:|:-------------|:------|:---------------------|
| 60fps  | [0, 16.67ms) | 7.0s  | [7.01667s, 7.03333s) |
| 120fps | [0, 8.33ms)  | 7.0s  | [7.00833s, 7.01667s) |

这个区间就是**不稳定区间**：距离技能 note 时间差落在此范围内的 note，其是否能吃到加成取决于 offset_skill 的实际取值，无法从静态参数确定，只能在运行时观测。

**帧率越高，不稳定区间越窄、越偏左。** 120fps 的 offset 上界只有 8.33ms，区间长度为 8.33ms；60fps 的 offset 上界为 16.67ms，区间长度为 16.67ms。对于紧贴在窗口右边缘的 note，60fps 有更大余量将它包括，120fps 则更早截断。

---

## 7. 地址速查

| 函数/字段                         | 地址          | 说明                                  |
|-------------------------------|-------------|-------------------------------------|
| `NoteInformation..ctor`       | `0x2B24694` | absolutePos 计算                      |
| `GetBarSeconds`               | `0x2C013EC` | `return 240.0 / bpm`                |
| `GetSecWithDistance`          | `0x2C00ED8` | 位置差转时间差                             |
| `MoveState`                   | `0x2FC0F78` | 判定主逻辑                               |
| `get_MusicPos`                | `0x332E600` | MusicPos 计算                         |
| `UpdateMusicScoreProgress`    | `0x332E9FC` | 每帧 MusicPos 递推                      |
| `NoteManager.Update`          | `0x2B2A410` | 子帧分割逻辑（n4 机制）                       |
| `ExecUpdate`                  | `0x3351C64` | 技能逐帧状态机                             |
| `Time.deltaTime`              | `0x5D351DC` | `UnityEngine.Time::get_deltaTime()` |
| `processOfSkillTriggered`     | `0x3352C50` | 激活技能，设置 timer                       |
| `sub_3352370`                 | `0x3352370` | forcePerfect → changeState(1) 的桥接函数 |
| `FinishSkill`                 | `0x335302C` | 终止技能，清空 currentPlayingSkillData     |
| `updatePlayState`             | `0x33E4F70` | 主更新循环（含 NoteManager/ExecUpdate 顺序）  |
| `SetExecuteFrame`             | `0x332DF7C` | `executeFrame = value`（覆盖赋值）        |
| `get_CurrentPlayingSkillData` | `0x3351718` | `return *(this + 0x80)`             |

---

## 8. 静态分析的边界

- **`MUSIC_BAR_DIVISION_COUNT`（CONSTANT）**：BSS 区域未初始化，元数据中无 FieldDefaultValue。在所有判定帧公式中会被约掉，不影响结论。
- **`MasterSkill.duration`**：服务器下发的卡牌数据，静态分析不可见。
- **实际丢帧概率**：60Hz vs 120Hz 的丢帧发生率无法从静态分析得出，依赖设备和系统环境。