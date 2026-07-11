# rid (X-Requestid) 生成逻辑分析

## 结论

**`X-Requestid = MD5(requestKey + requestID)`**

客户端用编译时硬编码的静态密钥 `requestKey` 对服务端下发的 `requestID` 做 MD5 哈希，结果作为 `X-Requestid` 请求头发送。服务端在响应头中返回新的 `requestID`，客户端原样存储用于下次请求。

## 密钥

**`requestKey = "44859ad705d454676f9184af633e6e4f"`**

32 位十六进制字符串，从 IL2CPP 元数据 `stringLiteral[1833]` 提取。索引 1833 来自静态槽预初始化值 `0xa0000e53` 的解码（见下文步骤 3）。不同版本预初始化值不同，索引也会变，但解码方法通用。

## 参考实现

```python
from hashlib import md5

REQUEST_KEY = "44859ad705d454676f9184af633e6e4f"

def compute_request_id(response_header: str) -> str:
    """用服务端响应头中的新 requestID 计算下一次请求的 X-Requestid"""
    return md5((REQUEST_KEY + response_header).encode()).hexdigest()

# 使用: 每次收到 HTTP 响应后, 提取 X-Requestid 响应头, 传入此函数
next_rid = compute_request_id("79c1bec75169bfbe502ec8b03a1cd016")
# → "28be12efa838a80f43a7d1f5dd5aaa9a"
```

```typescript
import { createHash } from "crypto";

const REQUEST_KEY = "44859ad705d454676f9184af633e6e4f";

function computeRequestId(responseHeader: string): string {
  return createHash("md5")
    .update(REQUEST_KEY + responseHeader)
    .digest("hex");
}

// 使用
const nextRid = computeRequestId("79c1bec75169bfbe502ec8b03a1cd016");
// → "28be12efa838a80f43a7d1f5dd5aaa9a"
```

## 验证

5 组抓包数据全部通过:

| 响应头 `X-Requestid` (新 requestID)    | 下一次请求的正确 `X-Requestid`             | MD5(key+响应值) |
|------------------------------------|------------------------------------|--------------|
| `79c1bec75169bfbe502ec8b03a1cd016` | `28be12efa838a80f43a7d1f5dd5aaa9a` | ✓            |
| `8031faeec46f200eb468e71b6bddb1f2` | `8eaa033c044d8cc9375a4bc48c0ccdb7` | ✓            |
| `81ff7a45b9cb39b39214c79a65a6961c` | `8eaff8aa6f04cca34fe7080e793d1e8d` | ✓            |
| `252b1f982c56abc7289417dff0fc55a2` | `f2cb9c7ff1efb4ec39fe7aad56c7103d` | ✓            |
| `25cfdd13f02dc2265652996c3814f17c` | `4872d3b8f73410d4669c4502cb937f67` | ✓            |

---

## 数据结构

`UserAccountManager` 关键字段（il2cpp dump + IDA 确认）:

| 字段         | 偏移   | 类型     | 来源                      |
|------------|------|--------|-------------------------|
| userToken  | 0x98 | string | 服务端下发                   |
| requestID  | 0xA0 | string | 服务端响应头 `X-Requestid` 原值 |
| requestKey | 0xA8 | string | 静态常量（类初始化时设定，永不修改）      |

---

## 关键方法

### get_RequestKey()
- **VA**: `0x30F3E64`
- **行为**: 返回静态全局变量 `qword_656BE80` 指向的字符串

```asm
; 直接路径 (无泛型分发):
0x30F3EC4: ADRP X8, #off_62BFC28@PAGE
0x30F3EC8: LDR  X8, [X8, #off_62BFC28@PAGEOFF]  ; X8 = &qword_656BE80
0x30F3ED0: LDR  X0, [X8]                        ; X0 = *(&qword_656BE80) → 静态字符串
0x30F3ED8: RET
```

### get_RequestID()
- **VA**: `0x30F3E1C`
- **行为**: 返回实例字段 `*(this + 0xA0)`

```c
if ( (sub_32D47CC(61855, 0) & 1) == 0 )
    return *(_QWORD *)(a1 + 160);   // this + 0xA0
```

### UpdateRequestId(string requestId)
- **VA**: `0x30F7230`
- **行为**: 原样存储传入字符串到 `requestID`

```c
*(_QWORD *)(a1 + 160) = a2;        // this + 0xA0 = requestId (直接赋值)
sub_2778378(a1 + 160);             // il2cpp GC write barrier
```

- **调用者**: 仅被响应处理器调用（`SendRequest.MoveNext` at `0x48CBC08` / `0x48CD738`）

---

## 完整请求周期

### 阶段 1：构造请求 — MD5 签名

`APICore.<SendRequest>d__28.MoveNext`（`0x48CB470`）中的签名构造，反汇编证据：

```asm
; Step 1: 读取两个分量
0x48CB930:  MOV X1, XZR
0x48CB934:  BL   sub_30F3E64        ; X0 = get_RequestKey(userManager)   — 读静态全局
0x48CB938:  MOV X24, X0             ; X24 = requestKey

0x48CB93C:  LDR  X0, [X26]          ; X0 = &UserAccountManager_singleton
0x48CB940:  BL   sub_453871C         ; X0 = UserAccountManager.instance
0x48CB948:  MOV X1, XZR
0x48CB94C:  BL   sub_30F3E1C        ; X0 = get_RequestID(this)            — 读实例字段 +0xA0
0x48CB950:  MOV X1, X0              ; X1 = requestID (String.Concat 第二参数)

; Step 2: 拼接 — String.Concat(requestKey, requestID)
0x48CB954:  MOV X0, X24             ; X0 = requestKey (第一参数)
0x48CB958:  MOV X2, XZR             ; X2 = 0
0x48CB95C:  BL   sub_5218DA0        ; X0 = String.Concat(requestKey, requestID)

; Step 3: MD5 哈希
0x48CB960:  MOV X1, XZR
0x48CB964:  BL   sub_2D33A20        ; X0 = MD5.Hash(concat_result_bytes)

; Step 4: 设置 HTTP 头
0x48CB968:  ADRP X8, #off_630CC80
0x48CB96C:  LDR  X8, [X8, #off]    ; X8 = &"X-Requestid" (0x6583C38)
0x48CB974:  MOV X24, X0             ; X24 = MD5 结果
0x48CB978:  LDR  X1, [X8]           ; X1 = "X-Requestid"
0x48CB97C:  MOV X0, X22             ; X0 = httpClient
0x48CB980:  MOV X2, X24             ; X2 = MD5 hash 值
0x48CB984:  BL   sub_4A0CD28        ; SetHeader(httpClient, "X-Requestid", hash)
```

等价 C 伪代码：
```c
// Step 1: 读取两个分量
v18 = get_RequestKey(userManager);         // 静态密钥
v20 = get_RequestID(userManager);          // 服务端下发的 nonce

// Step 2: 拼接
v21 = String.Concat(v18, v20);             // requestKey + requestID

// Step 3: MD5 哈希
v22 = sub_2D33A20(v21, 0);                // MD5(requestKey + requestID)

// Step 4: 设置请求头
sub_4A0CD28(httpClient,                    // HttpClient 实例
    qword_6583C38 /* "X-Requestid" */,     // Header 名称
    v22,                                    // MD5 结果
    ...);
```

### 阶段 2：处理响应 — 存储新 nonce

同一函数中的响应处理：

```c
// 从 HTTP 响应头提取 X-Requestid
v43 = sub_4A0CCA8(responseHeaders, 
    qword_6583C38 /* "X-Requestid" */, ...);

// 非空检查（String.IsNullOrEmpty）
if ( (sub_5225F14(v43, 0) & 1) == 0 )
{
    // 原样存储为新的 requestID
    UpdateRequestId(userManager, v43);
}
```

### 阶段 3：下次请求

新的 `requestID` 存储在 `this + 0xA0`，下次请求自动使用 `MD5(requestKey, new_requestID)`。

---

## 哈希算法

通过 il2cpp 元数据确认：`MD5.Hash(byte[])` → 返回 32 位十六进制字符串。

---

## 数据流图

```
┌─ 客户端 ─────────────────────────────────────────────┐
│                                                       │
│  requestKey = "44859ad705d454676f9184af633e6e4f" (编译时常量)  │
│  requestID  (上次服务端响应下发的 nonce)                  │
│                                                       │
│  每次发送请求时:                                        │
│    payload = requestKey + requestID (字符串拼接)         │
│    signature = MD5(payload)                             │
│    Header: X-Requestid = signature                    │
│                                                       │
└──────────────────────┬────────────────────────────────┘
                       │ HTTP Request
│ X-Requestid: MD5(key, old_nonce)                       │
                       ▼
┌─ 服务端 ──────────────────────────────────────────────┐
│                                                       │
│  验证 MD5(key, old_nonce) == 请求头中的值                   │
│  生成 new_nonce (随机)                                  │
│                                                       │
└──────────────────────┬────────────────────────────────┘
                       │ HTTP Response
                       │ X-Requestid: new_nonce (原文)
                       ▼
┌─ 客户端 ─────────────────────────────────────────────┐
│                                                       │
│  responseHeaders["X-Requestid"] → new_nonce           │
│  UpdateRequestId(new_nonce)                           │
│    → requestID = new_nonce                            │
│                                                       │
│  下次请求: MD5(key, new_nonce)                          │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 关键地址汇总

| 符号                     | VA          | 说明                                   |
|------------------------|-------------|--------------------------------------|
| `get_RequestKey()`     | `0x30F3E64` | 返回静态密钥 `"44859ad7..."`               |
| `get_RequestID()`      | `0x30F3E1C` | 返回 `this + 0xA0`                     |
| `UpdateRequestId()`    | `0x30F7230` | 存储新的 nonce                           |
| `String.Concat`        | `0x5218DA0` | 拼接 key + id                          |
| `MD5.Hash`             | `0x2D339B8` | MD5 哈希计算                             |
| `SendRequest.MoveNext` | `0x48CB470` | 请求/响应主循环                             |
| `"X-Requestid"`        | `0x6583C38` | il2cpp String 对象                     |
| `requestKey` 值         | SL[1833]    | `"44859ad705d454676f9184af633e6e4f"` |

---

## 版本更新后如何重新获取 requestKey

`requestKey` 是编译时硬编码常量，版本更新后可能变化。以下方法可从新版本 SO 中静态提取，无需运行游戏。

### 步骤 1: 定位 `get_RequestKey()` 函数

该函数返回全局静态值而非实例字段。识别方法：

方法 A：用 Il2CppDumper 生成 `dump.cs` 和 `script.json`，搜索 `UserAccountManager` 类中 `get_RequestKey` 的地址 (VA)。

方法 B：在 IDA 中搜索字符串 `"X-Requestid"` 的交叉引用，找到 `SendRequest.MoveNext`。在其中寻找 `String.Concat` → `MD5.Hash` 的调用链，该链的两个输入分别来自 `get_RequestKey` 和 `get_RequestID`。

`get_RequestKey` 的反汇编特征：

```asm
ADRP X8, #GOT_PAGE
LDR  X8, [X8, #GOT_OFF]    ; X8 = &static_slot
LDR  X0, [X8]              ; X0 = *static_slot → 返回值
RET
```

### 步骤 2: 提取预初始化值

在 `get_RequestKey` 的初始化分支中，找到传给 `il2cpp_runtime_class_init` 的静态槽地址：

```asm
ADRP X0, #GOT_PAGE
LDR  X0, [X0, #GOT_OFF]    ; X0 = static_slot_address
BL   il2cpp_runtime_class_init
```

用 IDA 读取该 GOT 条目指向的地址处的值（8 字节小端）。本例中：

```
GOT 条目 off_62BFC28 → 0x656BE80
*(0x656BE80) = 0xa0000e53   ← 预初始化值
```

### 步骤 3: 解码预初始化值 → 字符串字面量索引

预初始化值的编码格式（il2cpp AOT 静态字段标记，所有版本通用）：

| 位域         | 含义                      |
|------------|-------------------------|
| bit 0      | 必须为 1（标记位）              |
| bits 1-28  | 字符串字面量索引                |
| bits 29-31 | 类型标记：5 = string literal |

```python
val = 0xa0000e53  # 从步骤 2 读取，每版本不同
str_index = ((val & 0xFFFFFFFF) >> 1) & 0x0FFFFFFF   # 32位无符号右移
type_tag = val >> 29                                    # 必须为 5
```

v9.4.1: `str_index = 1833`，指向 `"44859ad705d454676f9184af633e6e4f"`。

### 步骤 4: 从 global-metadata.dat 读取字符串

`global-metadata.dat` 位于 APK 的 `assets/bin/Data/Managed/Metadata/` 下。

```python
import struct

# 读取元数据表头
with open('global-metadata.dat', 'rb') as f:
    data = f.read()

# 表 0: stringLiteral (offset, count) — 每个 8 字节 (int32 len, int32 dataOff)
# 表 1: stringLiteralData (offset, count) — 字符串数据 blob
sl_off = struct.unpack_from('<I', data, 8 + 0*8)[0]      # stringLiteral 表起始
sld_off = struct.unpack_from('<I', data, 8 + 1*8)[0]     # stringLiteralData 表起始

def read_sl(idx):
    entry = sl_off + idx * 8
    length = struct.unpack_from('<i', data, entry)[0]
    data_off = struct.unpack_from('<i', data, entry + 4)[0]
    abs_off = sld_off + data_off
    return data[abs_off:abs_off+length].decode('utf-8')

requestKey = read_sl(str_index)  # str_index 来自步骤 3 的解码结果
```

### 步骤 5: 验证

用抓包得到的一对 (响应头值, 下一次请求头值) 验证：

```python
from hashlib import md5
key = read_sl(str_index)
assert md5((key + response_header).encode()).hexdigest() == next_request
```

### v9.4.1 关键地址参考

| 组件                 | 地址/值                   | 说明                  |
|--------------------|------------------------|---------------------|
| `get_RequestKey()` | `0x30F3E64`            | 函数入口                |
| GOT 条目             | `off_62BFC28`          | 指向静态槽 `0x656BE80`   |
| 静态槽地址              | `0x656BE80`            | 存储 requestKey 运行时句柄 |
| 预初始化值              | `0xa0000e53`           | 每版本不同               |
| 解码 → SL 索引         | `(val>>1) & 0xFFFFFFF` | 通用公式                |

---

*分析日期: 2026-07-09*
