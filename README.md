# GarupaSpeedTracker

GarupaSpeedTracker 是一个用于查看 Bestdori 榜线分速的全栈项目，包含：

- `backend/`：Koa + TypeScript 后端，负责转发 Bestdori API、做参数校验和数据整理
- `frontend/`：Vue 3 + TypeScript + Tailwind CSS 前端，负责展示活动信息、分数表格和自动刷新

## 默认端口与路径

- 前端开发服务器 / Nginx 服务：`5913`
- 后端服务：`5519`
- 后端 API 基址：`/api`
- 后端本地默认监听：`http://127.0.0.1:5519`
- 前端默认 API 基址：`API_BASE_DEFAULT=/api`
- 前端后端 API 地址：`BACKEND_API_URL=http://127.0.0.1:5519/api`
- 前端浏览器请求默认走同源 `/api`
- 前端容器启动时会把 `DEFAULT_*` / `API_BASE_DEFAULT` / `BACKEND_API_URL` 等环境变量写入 `runtime-config.js`，前端 `config.ts` 会在启动时读取这些值

## 启动方式

### 使用 Docker Compose 启动

如果你安装了 Docker 和 Docker Compose

可以使用docker直接启动

首先在创建一个目录，并创建`docker-compose.yml`

将下面的yml复制进`docker-compose.yml`中

```yml
services:
    # 后端服务
    grp-speed-backend:
        image: ghcr.io/starfreedomx/garupa-speed-tracker-backend:latest
        container_name: garupa-speed-backend
        restart: always

    # 前端服务
    grp-speed-frontend:
        image: ghcr.io/starfreedomx/garupa-speed-tracker-frontend:latest
        container_name: garupa-speed-frontend
        restart: always
        ports:
            - "5913:5913"
        depends_on:
            - grp-speed-backend
```

启动

```shell
docker compose up -d
# 如果使用旧版docker compose (v1),则使用docker-compose up -d
```

#### 默认配置

```yaml
grp-speed-backend:
    # ......
    environment:
        - PORT=5519
        - HOST=0.0.0.0
        - API_PREFIX=/api
        - BESTDORI_API=https://bestdori.com/api/
        - MIN_UPDATE_TIME=45
        - BESTDORI_TIMEOUT_MS=10000
        - ENABLE_CORS=false
        - APP_PROXY=false
grp-speed-frontend:
    # ......
    environment:
        # 运行时配置会写入 runtime-config.js，config.ts 会在启动时读取这些值
        # 前端默认 API 基址；浏览器请求默认使用这个值
        - API_BASE_DEFAULT=/api
        # 指定后端 API 基址；前端请求会把 /api/... 后面的路径直接追加到这个地址后
        # Docker环境默认值为http://grp-speed-backend:5519/api
        # 其他环境默认值为http://localhost:5519/api
        - BACKEND_API_URL=http://grp-speed-backend:5519/api
        # 默认查询设置
        - DEFAULT_SERVER=0
        - DEFAULT_EVENT=328
        - DEFAULT_SAMPLE_INTERVAL_SECONDS=30
        - DEFAULT_REQUEST_MODE=smart-refresh
        - DEFAULT_REQUEST_INTERVAL_SECONDS=60
        - DEFAULT_AUTO_RETRY_DELAY_SECONDS=30
        - DEFAULT_REQUEST_MINUTE_INTERVAL=1
        - DEFAULT_REQUEST_SECOND=0
        - DEFAULT_TIME_MINUTES=60
        - DEFAULT_ROWS_PER_PAGE=60
        - DEFAULT_PRIMARY_HUE=340
        - DEFAULT_API_MODE=frontend
        - DEFAULT_API_BACKEND_BASE_URL=
```

### 后端环境变量说明

详见[backend/README.md](backend/README.md#后端环境变量说明)

### 前端环境变量说明

详见[frontend/README.md](frontend/README.md#前端环境变量说明)


## 本地开发

先分别安装依赖，然后启动前后端：

```shell
pnpm install
pnpm dev
```

也可以分别启动：

```shell
pnpm dev:backend
pnpm dev:frontend
```

## 构建

```shell
pnpm build
```

如果只想构建单个子项目：

```shell
pnpm build:backend
pnpm build:frontend
```

## Docker

仓库支持通过 `docker-compose.yml` 一键启动前后端：

```shell
pnpm docker-build
```

如果本地需要走代理：

```shell
pnpm docker-build-proxy
```

容器内默认约定：

- 后端容器监听 `5519`
- 前端容器监听 `5913` 并暴露到容器外
- 前端 Nginx 会把 `/api/` 反向代理到后端容器的 `/api/`

## 设置页中的后端 API 地址

前端设置页中的“后端 API 地址”用于手动指定请求目标，可以填写任意完整的 API 基址，例如：

```text
https://backend.example.com/api
```

也可以填写版本化路径，例如：

```text
https://backend.example.com/api/v2
```

如果后端与当前页面不是同源，请确保后端已开启 CORS，或者通过同源反向代理访问。

## API 文档

- 后端接口说明：`backend/API.md`
- 后端运行说明：`backend/README.md`
- 前端运行说明：`frontend/README.md`


