# GarupaSpeedTracker 后端

这是一个用于 Bestdori 排名分速追踪的 Koa2 + TypeScript 后端。

## 功能特性

- 基于 Koa2 + `@koa/router` + `koa-parameter` 的参数校验
- 通过 keep-alive TCP 连接复用获取 Bestdori 上游数据
- 按 `server:event:interval` 进行内存缓存
- 共享进行中的 Promise，避免并发重复请求上游
- 统一处理 422/502/504/404 错误
- 内置浏览器 CORS 支持，可通过环境变量配置
- 玩家编队查询：通过 Bestdori 和 Garupa 游戏服务器查询玩家编队信息，计算综合力、活动加成和技能数据
- 活动排名追踪：支持多服务器活动 Top 分和档线数据采集、存储、查询，初次启动自动从 Bestdori 同步当期数据
- 月榜数据追踪：支持多服务器月榜 Top 分和档线数据采集、存储、查询
- 歌曲列表与谱面数据缓存：定时抓取并缓存 Bestdori 歌曲元数据和谱面分布数据
- MongoDB 持久化存储：活动排名、月榜数据、Garupa 元信息通过 MongoDB 持久化；使用驱动内置 SDAM 心跳监控连接状态，支持自动重连
- 启动时自动预热缓存，拉取缺失数据；活动/月榜数据支持定时轮询更新
- 诊断日志：解析失败时自动保存原始响应到 `cache/diag/`，便于离线排查

## 快速开始

1. 复制环境变量模板：

```shell
Copy-Item .env.example .env
```

2. 安装并运行：

```shell
pnpm install
pnpm dev
```

3. 构建生产版本：

```shell
pnpm build
pnpm start
```

## 日志颜色

终端日志按模块着色，并显示日志级别：`INFO` 为普通信息，`SUCCESS` 为绿色，`WARN` 为黄色，`ERROR` 为红色。HTTP 响应中，4xx 显示黄色，5xx 显示红色，其余状态显示绿色。

默认仅在交互式终端启用颜色，重定向到文件时输出纯文本。可通过 `FORCE_COLOR=1` 强制开启（例如 Docker 或管道输出），通过 `NO_COLOR=1` 或 `FORCE_COLOR=0` 关闭；`NO_COLOR` 优先。

## 后端环境变量说明

在 `backend/` 目录运行后端。配置按以下顺序读取，先读到的值优先：进程环境变量 → `.env.local` → `.env` → `.env.example` → 代码默认值。修改后重启后端。帐号、密码和密钥填写在本地 `.env` 中。

下表列出代码默认值；`.env.example` 中的示例值也会参与加载。例如，模板将 `GARUPA_CLIENT_VERSIONS` 设为 `-,-,-,-`，覆盖代码中的日服回退版本。布尔值使用 `true` / `false` 或 `1` / `0`。

### 服务与缓存

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `HOST` | `127.0.0.1`；Docker 为 `0.0.0.0` | 后端监听地址 |
| `PORT` | `5519` | 后端监听端口 |
| `API_PREFIX` | `/api` | API 路由前缀；修改时同步调整前端代理目标 |
| `BESTDORI_API` | `https://bestdori.com/api/` | Bestdori API 地址 |
| `MIN_POINTS_UPDATE_TIME` | `45` | 最新榜线数据距当前不足此秒数时复用缓存 |
| `DOWNLOADER_TIMEOUT_MS` | `10000` | 通用下载器请求超时（毫秒），包括 Bestdori 和游戏榜单请求 |
| `INFO_CACHE_TIME` | `43200` | 静态信息缓存时间（秒） |
| `MEMORY_CACHE_MAX_ENTRIES` | `24` | 内存缓存最大条目数 |
| `MEMORY_CACHE_MAX_BYTES` | `268435456` | 内存缓存容量（字节，256 MiB） |
| `DISK_CACHE_MAX_BYTES` | `1073741824` | 磁盘缓存容量（字节，1 GiB） |
| `DISK_CACHE_CLEANUP_INTERVAL_MS` | `300000` | 磁盘缓存清理周期（毫秒） |
| `BESTDORI_SONGS_CHECK_INTERVAL_MS` | `86400000` | 歌曲数据检查周期（毫秒） |
| `BESTDORI_STORE_RAW_CHARTS` | `false` | 是否将原始谱面 JSON 保存到 `data/raw/charts/` |
| `ENABLE_CORS` | `false` | 是否启用 CORS 响应头和 `OPTIONS` 预检处理 |
| `APP_PROXY` | `false` | 是否信任反向代理头，用于获取客户端 IP 等信息 |

### 游戏服务器

列表按日服、国际服、台服、国服排列，索引为 `0`、`1`、`2`、`3`。未配置的区服使用 `-` 占位，避免空项被过滤后错位。`GARUPA_USER_AGENTS` 当前按逗号拆分，无法直接填写含逗号的完整 User-Agent；建议沿用内置值。

启用某个区服的榜单采集，先填写该服的 API 地址、AES Key/IV 和客户端请求参数。日服、国际服、台服还需 UID/UUID；国服使用下节的帐号密码登录。

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `GARUPA_SERVER_BASES` | `-,-,-,-` | 游戏 API 地址；可填域名或完整 API 基址，域名自动补为 `https://域名/api/` |
| `GARUPA_UIDS` | `-,-,-,-` | 各服玩家 UID；国服由登录流程获取 |
| `GARUPA_UUIDS` | `-,-,-,-` | 各服客户端 UUID（`X-Signature`）；国服由登录流程获取 |
| `GARUPA_CLIENT_VERSIONS` | `10.1.3,-,-,-` | 自动版本查询失败时使用的回退版本；模板为 `-,-,-,-` |
| `GARUPA_UNITY_VERSIONS` | `2021.3.45f2,-,-,2022.3.62f3c1` | Unity 版本 |
| `GARUPA_USER_AGENTS` | 日服与国服对应的 UnityPlayer User-Agent | 客户端 User-Agent |
| `GARUPA_CLIENT_PLATFORMS` | `Android` | 客户端平台；模板为 `Android,-,-,Android` |
| `GARUPA_ENCRYPTION_KEYS` | `-,-,-,-` | AES-128-CBC Key，每项须为 16 字节 UTF-8 文本 |
| `GARUPA_ENCRYPTION_IVS` | `-,-,-,-` | AES-128-CBC IV，每项须为 16 字节 UTF-8 文本 |
| `GARUPA_RKEYS` | `-,-,-,-` | 国服 RID 签名密钥，填写第 4 项 |
| `GARUPA_CIDS` | `-,-,-,-` | 渠道 ID；国服必填，模板第 4 项为 `1` |
| `GARUPA_PIDS` | `-,-,-,-` | 平台 ID；国服必填，模板第 4 项为 `2` |
| `GARUPA_PACKAGE_URLS` | 各服 App Store 查询地址 | 自动查询客户端版本的地址，按上述区服顺序填写 |

以下兼容名称仍可使用：`GARUPA_CLIENT_VERSION`、`GARUPA_UNITY_VERSION`、`GARUPA_USER_AGENT`、`GARUPA_CLIENT_PLATFORM`、`GARUPA_ENCRYPTION_KEY`、`GARUPA_ENCRYPTION_IV`。对应复数名称有非空值时优先使用复数配置。

### 国服帐号密码登录

启用国服榜单采集时，填写共享列表的第 4 项：`GARUPA_SERVER_BASES`、`GARUPA_ENCRYPTION_KEYS`、`GARUPA_ENCRYPTION_IVS`、`GARUPA_RKEYS`、`GARUPA_CIDS`、`GARUPA_PIDS`、`GARUPA_CLIENT_PLATFORMS`，并核对 Unity 版本与 User-Agent。

再填写下表中的必填项。设备型号、系统和广告标识在模板中提供了示例值，部署时按客户端填写；版本代码、SDK 版本和安装包签名需与客户端匹配。

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `GARUPA_CN_SDK_APP_KEY` | 空 | 必填，B 站 SDK 表单签名密钥 |
| `GARUPA_CN_ACCOUNT` | 空 | 必填，B 站 SDK 登录帐号 |
| `GARUPA_CN_PASSWORD` | 空 | 必填，登录密码 |
| `GARUPA_CN_DEVICE_ID` | 空 | 必填，游戏设备标识；BUVID 留空时须为 32 位十六进制字符串 |
| `GARUPA_CN_DEVICE_MODEL` | 空 | 必填，设备品牌和型号 |
| `GARUPA_CN_DEVICE_OS` | 空 | 必填，Android 系统描述 |
| `GARUPA_CN_AD_ID` | 空 | 必填，游戏登录使用的广告标识 |
| `GARUPA_CN_APK_SIGN` | 空 | 必填，Android 安装包签名指纹 |
| `GARUPA_CN_SDK_BASE` | `https://line1-sdk-center-login-sh.biligame.net` | SDK 登录服务地址，须为不含帐号密码的 HTTPS URL |
| `GARUPA_CN_BUVID` | 空 | 留空时由设备标识生成 |
| `GARUPA_CN_SDK_UDID` | 空 | 留空时复用 BUVID |
| `GARUPA_CN_BD_ID` | 空 | SDK 设备标识；留空时在当前客户端实例内随机生成并复用，可能触发验证码 |
| `GARUPA_CN_SDK_VERSION` | `6.19.5` | B 站 SDK 版本 |
| `GARUPA_CN_VERSION_CODE` | `105` | Android 安装包版本代码，须为数字 |
| `GARUPA_CN_LOGIN_TIMEOUT_MS` | `30000` | 登录流程中每个 HTTP 请求的超时（毫秒），最小 `1000`；包括登录前游戏版本查询、SDK 公钥获取、SDK 登录和游戏登录 |
| `GARUPA_CN_LOGIN_RETRY_MS` | `30000` | 登录或认证请求失败后的冷却时间（毫秒），最小 `1000`；冷却结束后的下一次请求触发重试 |

榜单请求超时使用 `DOWNLOADER_TIMEOUT_MS`，App Store 版本查询使用 `MONTHLY_RANKING_VERSION_CHECK_TIMEOUT_MS`。遇到验证码要求时，本次自动登录会停止；当前登录流程不支持提交验证码。

### 轮询与版本检查

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `GARUPA_REFRESH_INTERVAL_SECONDS` | `60` | 榜单轮询基础间隔（秒） |
| `GARUPA_REFRESH_AT_SECOND` | `0` | 轮询触发秒数，填写 `0`–`59` |
| `MONTHLY_RANKING_VERSION_CHECK_TIMEOUT_MS` | `2000` | App Store 客户端版本查询超时（毫秒） |
| `MONTHLY_RANKING_STATUS_UNAVAILABILITY_THRESHOLD` | `3` | 连续失败达到此次数后判定区服不可用 |
| `MONTHLY_RANKING_STATUS_POLL_INTERVAL_MS` | `5000` | 区服不可用时的状态检查周期（毫秒） |
| `MONTHLY_RANKING_INFO_POLL_INTERVAL_MS` | `3600000` | 月榜信息检查周期（毫秒） |
| `MONTHLY_RANKING_REFRESH_INTERVAL_MS` | `GARUPA_REFRESH_INTERVAL_SECONDS × 1000` | 月榜排名刷新间隔（毫秒） |
| `EVENT_RANKING_INFO_POLL_INTERVAL_MS` | `3600000` | 活动信息检查周期（毫秒） |
| `EVENT_RANKING_REFRESH_INTERVAL_MS` | `GARUPA_REFRESH_INTERVAL_SECONDS × 1000` | 活动排名刷新间隔（毫秒） |
| `EVENT_POST_END_POLL_INTERVAL_MS` | `3600000` | 活动结束后的榜单补采间隔（毫秒） |
| `EVENT_POST_END_MAX_DURATION_MS` | `86400000` | 活动结束后继续补采的最长时间（毫秒，24 小时） |
| `MONTHLY_POST_END_POLL_INTERVAL_MS` | `3600000` | 月榜结束后的榜单补采间隔（毫秒） |
| `MONTHLY_POST_END_MAX_DURATION_MS` | `43200000` | 月榜结束后继续补采的最长时间（毫秒，12 小时） |

### MongoDB

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | 连接地址；Compose 中填写 `mongodb://grp-speed-mongodb:27017` |
| `MONGODB_DB` | `garupa` | 数据库名 |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | `60000` | 主连接选择可用服务器的超时（毫秒） |
| `MONGODB_CONNECT_TIMEOUT_MS` | `5000` | 连接可用性探测超时（毫秒） |
| `MONGODB_RECONNECT_INTERVAL_MS` | `5000` | MongoDB 心跳检查间隔（毫秒） |
| `MONGODB_STARTUP_RETRY_INTERVAL_MS` | `5000` | 数据库连接重试间隔（毫秒） |
| `MONGODB_GARUPA_META_COLLECTION` | `GarupaMeta` | Garupa 元信息集合 |
| `MONGODB_MONTHLY_TOP_POINTS_COLLECTION` | `monthly_top_points` | 月榜 Top 分集合 |
| `MONGODB_MONTHLY_BORDER_POINTS_COLLECTION` | `monthly_border_points` | 月榜档线集合 |
| `MONGODB_MONTHLY_INFO_COLLECTION` | `monthly_ranking_info` | 月榜信息集合 |
| `MONGODB_RANKING_PLAYERS_COLLECTION` | `ranking_players` | 排名玩家集合 |
| `MONGODB_EVENT_TOP_POINTS_COLLECTION` | `event_top_points` | 活动 Top 分集合 |
| `MONGODB_EVENT_BORDER_POINTS_COLLECTION` | `event_border_points` | 活动档线集合 |
| `MONGODB_MUSIC_TOP_POINTS_COLLECTION` | `music_top_points` | 歌榜 Top 分集合 |
| `MONGODB_MUSIC_BORDER_POINTS_COLLECTION` | `music_border_points` | 歌榜档线集合 |
| `MONGODB_EVENT_INFO_COLLECTION` | `event_info` | 活动信息集合 |

从旧配置迁移时，将 `BESTDORI_TIMEOUT_MS` 改为 `DOWNLOADER_TIMEOUT_MS`，将 `MONGODB_CONNECTION_TIMEOUT_MS` 改为 `MONGODB_SERVER_SELECTION_TIMEOUT_MS`。`DEFAULT_INTERVAL` 是固定的请求采样默认值，无法通过环境变量修改。`MONGODB_STARTUP_RETRY_MAX_MS` 当前不控制数据库重试时限，连接失败后会持续后台重试。

## 监听地址

- 本地默认地址：`http://127.0.0.1:5519`
- API 基础路径：`/api`
- Docker 容器内地址：容器内部监听 `http://0.0.0.0:5519`，并通过 compose 堆栈对外暴露

## API 文档

更多请求/响应结构和错误示例请查看 `API.md`。

### 接口概览

**榜线追踪**

- `GET /api/topPoints` — 获取活动榜线分速追踪数据

**活动与歌曲**

- `GET /api/events` — 获取活动列表
- `GET /api/songs` — 获取歌曲列表
- `GET /api/songMetadata.json` — 获取谱面分布元数据（支持 gzip）

**活动排名**

- `GET /api/eventtop/data` — 获取活动 Top / 歌榜 Top 分速快照（本地无数据时 302 跳转 Bestdori）
- `GET /api/tracker/data` — 获取活动档线 / 歌榜档线数据（本地无数据时 302 跳转 Bestdori）

**月榜相关**

- `GET /api/monthlyRanking/info.json` — 获取所有月榜期次的基础信息列表
- `GET /api/monthlyRanking/info.{monthlyRankingId}.json` — 获取单一期次月榜的详细信息
- `GET /api/monthlyRanking/top` — 获取月榜 Top 玩家分速快照
- `GET /api/monthlyRanking/border` — 获取月榜档线数据

**玩家编队**

- `GET /api/playerDeckStatus` — 查询玩家编队状态（综合力、活动加成、技能）

### 快速查询示例

```http
GET /api/topPoints?server=0&event=321&time=60
```

- `server`: `0|1|2|3|4` -> `jp|en|tw|cn|kr`
- `interval`: 可选，默认 `30000`
- `lastTimeStamp`: 可选的增量同步游标（`time >= lastTimeStamp`）

返回结构（简要）：

```json
[
  {
    "uid": 111798074,
    "points": [
      { "time": 1776744533635, "points": 6890100 },
      { "time": 1776744594696, "points": 6890100 }
    ],
    "info": {
      "name": "!",
      "introduction": "[00]"
    }
  }
]
```

```http
GET /api/playerDeckStatus?server=0&playerId=28012549
```

- `eventId`: 可选，不传或传 `0` 则自动匹配当前活动

返回结构（简要）：

```json
{
  "eventType": "mission_live",
  "eventName": "雨上がり、瞳に映る空は",
  "eventId": 297,
  "normalPower": 320000,
  "eventPower": 380000,
  "autoPower": 320000,
  "eventBonusPct": 150,
  "skills": [
    { "bonusPercent": 110, "durationSeconds": 5.5, "progressive": null }
  ]
}
```

### 歌曲主数据与计分等级

歌曲信息直接读取日服 `/suite/master`（AES 解密、BZip2 解压、protobuf 解析）。日服已有字段优先，Bestdori 只补充缺失字段及其他区服名称/时间，谱面 Note 数据仍使用 Bestdori。歌曲和难度列表以日服为准。

需配置 `GARUPA_ENCRYPTION_KEYS`、`GARUPA_ENCRYPTION_IVS` 的第 0 项（日服）；沿用现有配置的编码格式。此接口不需要 UID/UUID。日服地址在未配置 `GARUPA_SERVER_BASES[0]` 时默认使用 `https://api.garupa.jp/api/`，客户端版本从 App Store 查询，失败时使用 `GARUPA_CLIENT_VERSIONS` 的第 0 项。歌曲接口不依赖 MongoDB 初始化。

`playLevel`/谱面 `level` 用于显示，`scoreLevel` 用于分数计算；游戏未设置 `scoreLevel`（缺失或 0）时使用 `playLevel`。例如 Game Changer Expert 显示 Lv29，计分使用 Lv28。

刷新周期沿用 `BESTDORI_SONGS_CHECK_INTERVAL_MS`。旧谱面缓存首次访问会自动迁移，并复用 Note 统计。日服暂时不可用时保留上次日服快照；无日服快照的首次运行会返回错误，不会改用 Bestdori 的显示等级计分。

### 国服帐号密码登录

国服（server=3）首次排名请求通过 B 站 SDK 使用帐号密码登录，再建立游戏会话。月榜和活动榜共享串行的 token/nonce 链，URL 使用登录返回的游戏 UID。榜单 HTTP 请求统一由 `downloader.downloadRaw` 发送，会话层负责登录、串行控制及 token/nonce 更新。HAR 和旧会话凭据不参与登录。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `GARUPA_CN_ACCOUNT` / `GARUPA_CN_PASSWORD` | 空 | B 站 SDK 帐号和密码，启用国服排名时必填 |
| `GARUPA_CIDS` / `GARUPA_PIDS` / `GARUPA_CLIENT_PLATFORMS` | 沿用各服配置 | 第四项：安卓 `1` / `2` / `Android`；iOS `1000` / `1` / `iOS` |
| `GARUPA_CN_VERSION_CODE` | `105` | 实测可以省略 |
| `GARUPA_CN_LOGIN_TIMEOUT_MS` | `30000` | 国服登录流程中每个 HTTP 请求的超时上限（毫秒）：登录前查询游戏版本信息、SDK 获取公钥、SDK 帐号密码登录、游戏登录；每个请求独立计时，默认 30 秒 |
| `GARUPA_CN_LOGIN_RETRY_MS` | `30000` | 失败后重新登录的最短等待时间（毫秒） |

`GARUPA_CN_LOGIN_TIMEOUT_MS` 从每个登录相关 HTTP 请求发起时开始计时，覆盖连接、等待响应和读取响应体；超时会中止请求并丢弃当前会话。它不限制整套登录／爬取流程的总时长，也不包含排队时间。国服榜单请求沿用通用的 `DOWNLOADER_TIMEOUT_MS`（默认 10000 毫秒），不受此登录超时配置影响。iTunes 版本查询及其他通用下载器请求也不使用此配置。

登录前从 application 获取 data/master 版本，并检查客户端版本是否匹配。版本号查询不会自动更新 Android versionCode。

会话仅每次启动时保存在内存中，重启后重新登录。请求失败或超时时丢弃会话；成功响应有非空 token/nonce 才更新对应状态，缺失或空值保留旧值，冷却后由下次排名请求重新登录。SDK 返回需要验证码时明确报错并停止本次登录，暂不支持验证码提交或续登（TODO）。

国服无需手填 UID、UUID。同一帐号建议只运行一个采集进程，避免不同会话互相影响。

设备参数的填写说明见 `.env.example`。可留空的设备标识按以下规则处理：

- `GARUPA_CN_BUVID`：根据 `GARUPA_CN_DEVICE_ID` 生成，要求设备 ID 为 32 位十六进制字符串。
- `GARUPA_CN_SDK_UDID`：复用 BUVID。
- `GARUPA_CN_BD_ID`：随机生成，当前进程内复用，重启后重新生成。建议填写官方客户端成功登录请求中的 `bd_id`；随机值可能触发验证码。
