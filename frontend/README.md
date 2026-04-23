# GarupaSpeedTracker 前端

这是一个使用 Vue 3 + TypeScript + Tailwind 的单页分速查看前端。

启用后端模式时，默认后端 API 地址为 `http://localhost:5519/api`。

对外暴露端口：5913

## 功能特性

- 侧边栏 + 顶部状态栏 + 内容区布局
- 顶部栏左侧菜单按钮可平滑控制侧边栏展开/收起
- 基于 CSS 变量的主题系统（`frontend/style/main.css`）
- 每 60 秒自动刷新，并支持暂停和手动刷新
- 首页中的 Event ID 修改必须显式确认后才会生效
- 高级查询参数（`server` / `interval` / `time`）在设置页中配置
- 刷新控制位于表格上方，并与活动选择一起显示（不放在顶部栏）
- 自动刷新会对齐到整分钟边界，并显示倒计时秒数
- 固定的时间戳列和对齐的玩家表格
- 支持缺失分数时的回退规则来计算差值
- 通过 `lastTimeStamp` 支持增量同步
- 查询默认值和主题设置会保存在浏览器 `localStorage` 中
- 设置页提供后端 API 地址输入框；你可以手动填写任意 API 基址，例如 `/api` 或 `/api/v2`

## 运行

```shell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

## 构建

```shell
pnpm build
pnpm start
```

如果你只想启动 Vite 预览服务器：

```shell
pnpm preview
```

## 前端环境变量说明

| 变量名                                | 默认值                                 | 作用                                         |
|------------------------------------|-------------------------------------|--------------------------------------------|
| `API_BASE_DEFAULT`                 | `/api`                              | 前端浏览器同源请求的默认 API 基址，也是 `config.ts` 的唯一默认来源 |
| `PORT`                             | `5913`                              | `pnpm start` 本地静态启动时的监听端口                  |
| `HOST`                             | `localhost`                         | `pnpm start` 本地静态启动时的监听主机                  |
| `BACKEND_API_URL`                  | `http://grp-speed-backend:5519/api` | 指定后端 API 基址；本地 `/api/...` 会去掉前缀后直接追加到这个地址后 |
| `DEFAULT_SERVER`                   | `0`                                 | 默认服务器                                      |
| `DEFAULT_EVENT`                    | `328`                               | 默认活动 ID                                    |
| `DEFAULT_SAMPLE_INTERVAL_SECONDS`  | `30`                                | 默认采样间隔（秒）                                  |
| `DEFAULT_REQUEST_MODE`             | `smart-refresh`                     | 默认请求模式                                     |
| `DEFAULT_REQUEST_INTERVAL_SECONDS` | `60`                                | 固定间隔模式默认请求间隔（秒）                            |
| `DEFAULT_AUTO_RETRY_DELAY_SECONDS` | `30`                                | 智能刷新失败后的重试延迟（秒）                            |
| `DEFAULT_REQUEST_MINUTE_INTERVAL`  | `1`                                 | 固定分钟模式默认分钟间隔                               |
| `DEFAULT_REQUEST_SECOND`           | `0`                                 | 固定分钟模式默认请求秒数                               |
| `DEFAULT_TIME_MINUTES`             | `60`                                | 默认时间窗口（分钟）                                 |
| `DEFAULT_ROWS_PER_PAGE`            | `60`                                | 表格默认每页行数                                   |
| `DEFAULT_PRIMARY_HUE`              | `340`                               | 默认主题色相                                     |
| `DEFAULT_API_MODE`                 | `frontend`                          | 默认 API 模式                                  |
| `DEFAULT_API_BACKEND_BASE_URL`     | 空                                   | 设置页“后端 API 地址”的初始值                         |

> 说明：这些前端环境变量既可以在本地 `pnpm start` 时读取，也可以通过 `docker-compose.yml` 传入容器；容器启动后会生成 `runtime-config.js`，前端 `config.ts` 会优先读取其中的值。


## 说明

- 浏览器侧请求默认使用同源 `/api`，应由前端代理/反向代理转发。
- Vite 开发服务器会对 `/api/*` 进行代理：去掉开头的 `/api`，再将剩余路径追加到 `BACKEND_API_URL`（默认 `http://127.0.0.1:5519/api`）。
- Docker/Nginx 模式遵循同样的规则：去掉本地请求中的 `/api` 前缀，然后将剩余部分追加到 `BACKEND_API_URL`。
- Docker/`pnpm start` 会在应用启动前根据容器环境变量生成 `/runtime-config.js`，因此 `API_BASE_DEFAULT`、`DEFAULT_EVENT`、`DEFAULT_ROWS_PER_PAGE`、`DEFAULT_PRIMARY_HUE`、`BACKEND_API_URL` 等值都可以通过 `docker-compose.yml` 注入。
- 当在设置页切换到后端 API 模式时，请输入你想要访问的完整 API 基址，例如 `http://backend.example.com/api` 或 `http://backend.example.com/api/v2`。
- 设置页只提供主主题色配置；按钮圆角和页面内边距统一集中在 `style/main.css` 中管理。
- 语言环境以中文优先，i18n 消息组织在 `src/i18n/messages` 下。

