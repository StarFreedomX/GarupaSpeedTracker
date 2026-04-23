# GarupaSpeedTracker 后端

这是一个用于 Bestdori 排名分速追踪的 Koa2 + TypeScript 后端。

## 功能特性

- 基于 Koa2 + `@koa/router` + `koa-parameter` 的参数校验
- 通过 keep-alive TCP 连接复用获取 Bestdori 上游数据
- 按 `server:event:interval` 进行内存缓存
- 共享进行中的 Promise，避免并发重复请求上游
- 统一处理 422/502/504/404 错误
- 内置浏览器 CORS 支持，可通过环境变量配置

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
| 变量名                   | 默认值                                    | 作用                              |
|-----------------------|----------------------------------------|---------------------------------|
| `HOST`                | `127.0.0.1`（本地）<br/> `0.0.0.0`（Docker） | 后端监听地址                          |
| `PORT`                | `5519`                                 | 后端监听端口                          |
| `API_PREFIX`          | `/api`                                 | 后端 API 路由前缀                     |
| `BESTDORI_API`        | `https://bestdori.com/api/`            | Bestdori 上游地址                   |
| `MIN_UPDATE_TIME`     | `45`                                   | 最短更新间隔（秒）                       |
| `BESTDORI_TIMEOUT_MS` | `10000`                                | 上游请求超时（毫秒）                      |
| `ENABLE_CORS`         | `false`                                | 是否启用 CORS 响应头和 `OPTIONS` 预检处理   |
| `APP_PROXY`           | `false`                                | 是否信任反向代理头，适用于部署在反代后面时获取真实客户端 IP |

## 监听地址

- 本地默认地址：`http://127.0.0.1:5519`
- API 基础路径：`/api`
- Docker 容器内地址：容器内部监听 `http://0.0.0.0:5519`，并通过 compose 堆栈对外暴露

## API 文档

更多请求/响应结构和错误示例请查看 `API.md`。

快速查询示例：

`GET /api/events`


`GET /api/scores?server=0&event=321&time=60`

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






