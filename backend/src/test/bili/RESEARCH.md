# 国服 (Bili/CN) API 爬取研究结论

## 一、端点总结

### 无需 X-Requestid 的端点
| 端点                        | 说明                  |
|---------------------------|---------------------|
| `GET /api/application`    | 版本/维护信息             |
| `GET /api/event`          | 活动主列表 (Master List) |
| `GET /api/monthlyranking` | 月榜主列表 (Master List) |

### 需要 X-Requestid 的端点
| 端点                                                                     | 说明   |
|------------------------------------------------------------------------|------|
| `GET /api/user/{uid}/event/{eventId}/{urlSegment}/ranking[?mid={mid}]` | 活动排名 |
| `GET /api/user/{uid}/monthlyranking/{monthlyId}/ranking`               | 月榜排名 |

## 二、请求 Headers

经过验证，国服 ranking 端点**必需**的 header 只有这些：

```
X-ClientVersion:     (见 .env GARUPA_CLIENT_VERSIONS[3])
X-PlatformID:        2
X-ChannelID:         1
X-Signature:         (见 .env GARUPA_UUIDS[3])
X-Requestid:         <32位 hex>
Content-Type:        application/octet-stream
Accept:              application/octet-stream
```

以下 header 经测试为**可选**（删掉仍正常返回）：
- X-DataVersion, X-MasterDataVersion, X-DeviceID
- X-Token, X-ClientPlatform, X-Unity-Version
- User-Agent, Accept-Encoding
Accept-Encoding:     deflate, gzip
Content-Type:        application/octet-stream
Accept:              application/octet-stream
```

## 三、X-Requestid 机制

### 错误响应
X-Requestid 不正确时返回 HTTP 405 + 加密 protobuf，解密后结构：
- field 1 (varint)  = 405  错误码
- field 2 (string)  = ""   空
- field 3 (string)  = `[URI:...][newRequestId:<新rid>][oldRequestId:<旧rid>] X-Requestid error.`
- field 40 (fixed64)

### 正确使用流程
1. 首先使用 `.env` 中配置的 rid（`GARUPA_RIDS[3]`）发起请求
2. 若 HTTP 405 且响应中包含 `X-Requestid error`，说明 rid 已过期
3. 解密 protobuf 错误响应，正则 `/\[newRequestId:([a-f0-9]+)\]/` 提取新 rid
4. 输出日志提示 rid 过期已更新，缓存新 rid 后用其重试
5. HTTP 200 → 正常获取数据

> **注意**：不应主动发送错误 rid 来获取正确 rid，而应将 rid 视为可过期的凭证，过期时从错误响应中自动刷新。

### rid 特性
- 可重复使用（非一次性）
- 可跨端点使用（monthly 错误响应获取的 rid 可用于 event）
- 可跨资源使用（同一 rid 可用于不同期月榜）

## 四、protobuf eventType → URL 路径段映射

来源：日服客户端反编译 URL 模板 + 国服抓包验证。日服国服使用相同的 URL 模板。

| protobuf eventType | URL 路径段 | 说明 |
|---|---|---|
| `challenge` | `challenge` | 一致 |
| `live_try` | `livetry` | 去下划线 |
| `medley` | `medley` | 一致 |
| `mission_live` | `mission` | 非简单去下划线 |
| `story` | `story` | 一致 |
| `team_live_festival` | `festival` | 完全不同 |
| `versus` | `versus` | 一致 |

> 映射定义见 `eventTypeMapping.ts`。构建 URL 时必须将 protobuf eventType 通过 `eventTypeToUrlSegment()` 转换。

## 五、加密参数

| 参数 | 日服 | 国服 |
|------|------|------|
| 算法 | AES-128-CBC | AES-128-CBC |
| KEY | 见 .env GARUPA_ENCRYPTION_KEYS[0] | 见 .env GARUPA_ENCRYPTION_KEYS[3] |
| IV | 见 .env GARUPA_ENCRYPTION_IVS[0] | 见 .env GARUPA_ENCRYPTION_IVS[3] |
| Padding | 无 (setAutoPadding(false)) | 无 |

## 六、数据解析

国服返回的 protobuf 结构与日服一致，现有解析器可直接使用：
- `GarupaEventRankingParser` — 活动排名
- `GarupaMonthlyRankingParser` — 月榜排名
- `GarupaEventInfoParser` — 活动信息
- `GarupaMonthlyRankingInfoParser` — 月榜信息

已验证：
- 活动排名 (live_try, eventId=316): Top=10, Border=25 ✅
- 月榜排名 (monthlyId=18): Top=10, Border=12 ✅
- 活动信息: 正常解析 ✅
- 月榜信息: 18 期月榜，正常解析 ✅

## 七、业务代码修改要点（未执行，仅供参考）

1. **config.ts**: 添加国服 server base URL、KEY/IV、UID/Token 等
2. **api/garupa.ts**:
   - `createGarupaHeaders()` 添加国服特有 headers（X-Requestid, X-Token 等）
   - `buildEventRankingUrl()` 添加 `eventTypeToUrlSegment()` 映射
   - 添加 X-Requestid 错误重试逻辑
3. **建议流程**: 请求前确保有效 rid → 405 时提取 newRequestId 重试 → 成功后缓存 rid

## 八、测试脚本

| 文件 | 用途 |
|------|------|
| `eventTypeMapping.ts` | protobuf eventType → URL 路径段映射 |
| `research-bili-e2e.ts` | **主入口** — 完整端到端验证 |
| `research-bili-connect.ts` | 基础连通性测试 |
| `research-bili-ranking.ts` | Ranking 研究（含错误解析） |
| `test-rid-key.ts` | 验证 newRequestId 直接请求 |
| `test-rid-cross.ts` | 验证 rid 跨端点/跨资源复用 |
| `test-rid-lifecycle.ts` | 验证 rid 生命周期 |
| `diagnose-event-proto.ts` | 诊断 protobuf 错误响应 |
| `diagnose-rid.ts` | 诊断不同 rid 的响应 |
| `verify-eventtype.ts` | 验证国服 protobuf eventType 原始值 |
| `verify-jp-eventtype-v2.ts` | 验证日服 eventType（需 live_try 活动） |
| `verify-jp-eventtype-v3.ts` | 扫描日服所有活动类型 |
| `check-jp-version.ts` | 检查日服客户端版本 |
