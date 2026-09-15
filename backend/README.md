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

## 后端环境变量说明
| 变量名                                               | 默认值                                    | 作用                                    |
|---------------------------------------------------|----------------------------------------|---------------------------------------|
| `HOST`                                            | `127.0.0.1`（本地）<br/> `0.0.0.0`（Docker） | 后端监听地址                                |
| `PORT`                                            | `5519`                                 | 后端监听端口                                |
| `API_PREFIX`                                      | `/api`                                 | 后端 API 路由前缀                           |
| `BESTDORI_API`                                    | `https://bestdori.com/api/`            | Bestdori 上游地址                         |
| `MIN_POINTS_UPDATE_TIME`                          | `45`                                   | 最短更新间隔（秒）                             |
| `BESTDORI_TIMEOUT_MS`                             | `10000`                                | 上游请求超时（毫秒）                            |
| `MEMORY_CACHE_MAX_ENTRIES`                        | `24`                                   | 内存缓存最大条目数                             |
| `MEMORY_CACHE_MAX_BYTES`                          | `268435456`                            | 内存缓存最大字节数                             |
| `DISK_CACHE_MAX_BYTES`                            | `1073741824`                           | 磁盘缓存最大字节数                             |
| `DISK_CACHE_CLEANUP_INTERVAL_MS`                  | `300000`                               | 磁盘缓存清理周期（毫秒）                          |
| `BESTDORI_SONGS_CHECK_INTERVAL_MS`                | `86400000`                             | Bestdori 歌曲列表检查周期（毫秒）                 |
| `BESTDORI_STORE_RAW_CHARTS`                       | `false`                                | 是否保存原始谱面数据                            |
| `DEFAULT_INTERVAL`                                | `30000`                                | 默认刷新间隔（毫秒）                            |
| `ENABLE_CORS`                                     | `false`                                | 是否启用 CORS 响应头和 `OPTIONS` 预检处理         |
| `APP_PROXY`                                       | `false`                                | 是否信任反向代理头，用于获取真实客户端 IP                |
| `GARUPA_SERVER_BASES`                             | `api.garupa.jp,-,-,-`                  | Garupa 服务器基址列表（逗号分隔）                  |
| `GARUPA_UIDS`                                     | `-,-,-,-`                              | 各服务器用户 UID（逗号分隔）                      |
| `GARUPA_UUIDS`                                    | `-,-,-,-`                              | 各服务器 UUID（逗号分隔）                       |
| `GARUPA_CLIENT_VERSIONS`                          | `10.1.1,-,-,-`                         | 客户端版本列表（逗号分隔）                         |
| `GARUPA_CLIENT_VERSION`                           | 同上                                     | 单值回退配置（被 `GARUPA_CLIENT_VERSIONS` 覆盖） |
| `GARUPA_UNITY_VERSIONS`                           | `2021.3.45f2`                          | Unity 版本列表（逗号分隔）                      |
| `GARUPA_UNITY_VERSION`                            | 同上                                     | 单值回退配置                                |
| `GARUPA_USER_AGENTS`                              | `UnityPlayer/...,-,-,-`                | User-Agent 列表（逗号分隔）                   |
| `GARUPA_USER_AGENT`                               | 同上                                     | 单值回退配置                                |
| `GARUPA_CLIENT_PLATFORMS`                         | `Android,-,-,-`                        | 客户端平台列表（逗号分隔）                         |
| `GARUPA_CLIENT_PLATFORM`                          | 同上                                     | 单值回退配置                                |
| `GARUPA_ENCRYPTION_KEYS`                          | `-,-,-,-`                              | AES Key 列表（16 字节）                     |
| `GARUPA_ENCRYPTION_KEY`                           | 同上                                     | 单值回退配置                                |
| `GARUPA_ENCRYPTION_IVS`                           | `-,-,-,-`                              | AES IV 列表（16 字节）                      |
| `GARUPA_ENCRYPTION_IV`                            | 同上                                     | 单值回退配置                                |
| `GARUPA_REFRESH_INTERVAL_SECONDS`                 | `60`                                   | Garupa 轮询基础间隔（秒）                      |
| `GARUPA_REFRESH_AT_SECOND`                        | `0`                                    | Garupa 轮询触发秒（0-59）                    |
| `GARUPA_PACKAGE_URLS`                             | `itunes...`                            | 自动获取客户端版本的包查询地址列表                     |
| `MONTHLY_RANKING_VERSION_CHECK_TIMEOUT_MS`        | `2000`                                 | 客户端版本检查超时（毫秒）                         |
| `MONTHLY_RANKING_STATUS_UNAVAILABILITY_THRESHOLD` | `3`                                    | 服务器不可用判定阈值                            |
| `MONTHLY_RANKING_STATUS_POLL_INTERVAL_MS`         | `5000`                                 | 服务器可用性轮询间隔（毫秒）                        |
| `MONTHLY_RANKING_INFO_POLL_INTERVAL_MS`           | `3600000`                              | 月榜信息轮询间隔（毫秒）                          |
| `MONGODB_URI`                                     | `mongodb://127.0.0.1:27017`            | MongoDB 连接地址                          |
| `MONGODB_DB`                                      | `garupa`                               | MongoDB 数据库名                          |
| `MONGODB_CONNECTION_TIMEOUT_MS`                   | `60000`                                | MongoDB 连接超时（毫秒）                      |
| `MONGODB_RECONNECT_INTERVAL_MS`                   | `5000`                                 | MongoDB 重连间隔（毫秒）                      |
| `MONGODB_GARUPA_META_COLLECTION`                  | `GarupaMeta`                           | Garupa 元信息集合                          |
| `MONGODB_MONTHLY_TOP_POINTS_COLLECTION`           | `monthly_top_points`                   | 月榜 Top 数据集合                           |
| `MONGODB_MONTHLY_BORDER_POINTS_COLLECTION`        | `monthly_border_points`                | 月榜档线数据集合                              |
| `MONGODB_MONTHLY_INFO_COLLECTION`                 | `monthly_ranking_info`                 | 月榜信息集合                                |
| `MONGODB_RANKING_PLAYERS_COLLECTION`              | `ranking_players`                      | 排名玩家信息集合                              |
| `MONGODB_EVENT_TOP_POINTS_COLLECTION`             | `event_top_points`                     | 活动 Top 分数据集合                           |
| `MONGODB_EVENT_BORDER_POINTS_COLLECTION`          | `event_border_points`                  | 活动档线数据集合                              |
| `MONGODB_MUSIC_TOP_POINTS_COLLECTION`             | `music_top_points`                     | 歌榜 Top 分数据集合                           |
| `MONGODB_MUSIC_BORDER_POINTS_COLLECTION`          | `music_border_points`                  | 歌榜档线数据集合                              |
| `MONGODB_EVENT_INFO_COLLECTION`                   | `event_info`                           | 活动信息集合                                |
| `EVENT_RANKING_INFO_POLL_INTERVAL_MS`             | `3600000`                              | 活动信息轮询间隔（毫秒）                          |
| `EVENT_RANKING_REFRESH_INTERVAL_MS`               | `60000`                                | 活动排名轮询间隔（毫秒）                          |
| `MONTHLY_RANKING_REFRESH_INTERVAL_MS`             | `60000`                                | 月榜排名轮询间隔（毫秒）                          |
| `INFO_CACHE_TIME`                                 | `43200`                                | 静态信息缓存时间（秒）                           |

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
