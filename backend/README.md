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
- 月榜数据追踪：支持多服务器月榜 Top 分和档线数据采集、存储、查询
- 歌曲列表与谱面数据缓存：定时抓取并缓存 Bestdori 歌曲元数据和谱面分布数据
- MongoDB 持久化存储：月榜数据、Garupa 元信息通过 MongoDB 持久化
- 启动时自动预热缓存，拉取缺失数据；月榜数据支持定时轮询更新

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
| `MONGODB_CONNECTION_TIMEOUT_MS`                   | `10000`                                | MongoDB 连接超时（毫秒）                      |
| `MONGODB_RECONNECT_INTERVAL_MS`                   | `5000`                                 | MongoDB 重连间隔（毫秒）                      |
| `MONGODB_GARUPA_META_COLLECTION`                  | `GarupaMeta`                           | Garupa 元信息集合                          |
| `MONGODB_MONTHLY_TOP_POINTS_COLLECTION`           | `monthly_top_points`                   | 月榜 Top 数据集合                           |
| `MONGODB_MONTHLY_BORDER_POINTS_COLLECTION`        | `monthly_border_points`                | 月榜档线数据集合                              |
| `MONGODB_MONTHLY_INFO_COLLECTION`                 | `monthly_ranking_info`                 | 月榜信息集合                                |

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
