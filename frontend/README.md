# GarupaSpeedTracker 前端

这是一个使用 Vue 3 + TypeScript + Tailwind 的单页分速查看前端。

浏览器默认请求同源 `/api`，由前端服务代理到后端。设置页中的“后端 API 地址”初始为空。

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
- 自动控分计算器：输入队伍配置后计算所有歌曲的 auto 分数和活动 PT；支持 Progressive 渐进式技能配置
- 精确分数计算弹窗：点击歌曲名可打开弹窗，拖拽排序技能顺序，实时计算精确的 auto 分数和 PT
- 交互式控分计算器：3 步向导引导用户配置队伍 → 设定目标 PT → 获取最优打歌策略方案，支持多种替代方案
- 玩家卡组查询：从游戏服务器（JP/EN/TW/CN/KR）导入编队，自动填充综合力、活动加成和技能配置
- 加成控分表：反向推算达到目标 PT 所需的活动加成百分比范围
- 高级筛选：支持屏蔽 FULL 曲、按乐队筛选含/全模式、权重字符串优先排序
- 最大连续可达区间预览：使用 Uint8Array bitmap 算法高效计算可达 PT 区间，帮助判断目标可行性
- 技能持续时间选择器：覆盖所有常用持续时间，双列下拉快速选取
- 倍率百分比格式显示：技能加成统一以百分比展示（如 ×150%），渐进式技能参数同步为百分比格式
- 数字输入优化：使用 `type="text"` + `inputmode="numeric"` 替代 `type="number"`，避免 IME 输入和事件触发问题
- 筛选防卡顿：高级筛选输入框使用 lazy 模式，失焦后才触发计算，避免频繁更新

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

### 按运行方式配置

| 运行方式 | 配置方式 | 生效时间 |
| --- | --- | --- |
| `pnpm dev` | 在 `frontend/.env` 中填写 `API_BASE_DEFAULT` 和 `BACKEND_API_URL`；Vite 也会加载 `.env.local` 和当前模式的 `.env` 文件 | 重启开发服务器 |
| `pnpm build` 后运行 `pnpm start` | 从进程环境变量、`.env.local`、`.env`、`.env.example` 依次读取，先读到的值优先；支持下表全部运行时配置 | 重启静态服务器 |
| Docker / Nginx | 在 Compose 前端服务的 `environment` 或 `env_file` 中填写，容器启动时生成 `runtime-config.js` | 重新创建前端容器，无需重新构建镜像 |
| 单独托管 `dist/` | 修改 `dist/runtime-config.js` 中的 `window.__GARUPA_RUNTIME_CONFIG__` 对象 | 重新加载页面 |

Vite 开发模式只注入 `API_BASE_DEFAULT`，`DEFAULT_*` 环境变量用于 `pnpm start` 和 Docker。开发时如需调整这些初始值，可在 `public/runtime-config.js` 中设置同名字段。单独执行 `pnpm build` 时，运行时配置仍取自该文件。

### 服务与 API 地址

| 变量名 | 默认值 | 作用 |
| --- | --- | --- |
| `API_BASE_DEFAULT` | `/api` | 浏览器请求使用的 API 基址 |
| `BACKEND_API_URL` | 开发：`http://127.0.0.1:5519/api`；本地静态启动：`http://localhost:5519/api`；Docker：`http://grp-speed-backend:5519/api` | 前端服务的代理目标；`.env.example` 提供 `localhost` 地址 |
| `PORT` | `5913` | 仅用于 `pnpm start` 的监听端口 |
| `HOST` | `localhost` | 仅用于 `pnpm start` 的监听地址 |
| `VITE_DEPLOY_TARGET` | 未设置 | 构建时设为 `github-pages`，浏览器默认 API 基址使用项目配置的公共后端；运行时 `API_BASE_DEFAULT` 可覆盖它 |

`BACKEND_API_URL` 由前端服务器访问，Docker 中可使用后端服务名。`API_BASE_DEFAULT` 和 `DEFAULT_API_BACKEND_BASE_URL` 由浏览器访问，填写浏览器能访问的地址。代理会去掉请求路径开头的 `/api`，再将剩余路径追加到 `BACKEND_API_URL`。

Vite 和 Nginx 的端口均为 `5913`，不读取上述 `PORT` / `HOST`。Docker 对外端口在 Compose 的 `ports` 中调整。跨域直连后端时，需在后端设置 `ENABLE_CORS=true`。

### 查询与显示初始值

以下是推荐填写的初始值，`.env.example` 已提供。Docker 部署时可复制到前端服务的 `environment` 中。

| 变量名 | 建议值 | 作用与范围 |
| --- | --- | --- |
| `DEFAULT_SERVER` | `0` | 默认服务器，`0`–`4` 对应日服、国际服、台服、国服、韩服 |
| `DEFAULT_EVENT` | `328` | 默认活动 ID，最小 `1` |
| `DEFAULT_SAMPLE_INTERVAL_SECONDS` | `30` | 采样间隔（秒），最小 `1` |
| `DEFAULT_REQUEST_MODE` | `smart-refresh` | 请求模式：`smart-refresh`、`fixed-interval`、`fixed-minute` |
| `DEFAULT_REQUEST_INTERVAL_SECONDS` | `60` | 固定间隔模式的请求间隔（秒），最小 `1` |
| `DEFAULT_AUTO_RETRY_DELAY_SECONDS` | `30` | 智能刷新失败后的重试延迟（秒），最小 `1` |
| `DEFAULT_REQUEST_MINUTE_INTERVAL` | `1` | 固定分钟模式的分钟间隔，最小 `1` |
| `DEFAULT_REQUEST_SECOND` | `0` | 固定分钟模式的触发秒数，`0`–`59` |
| `DEFAULT_TIME_MINUTES` | `60` | 查询时间窗口（分钟），最小 `2` |
| `DEFAULT_ROWS_PER_PAGE` | `60` | 表格每页行数，最小 `1` |
| `DEFAULT_PRIMARY_HUE` | `340` | 主题色相，`0`–`359` |
| `DEFAULT_API_MODE` | `frontend` | `frontend` 使用 `API_BASE_DEFAULT`；`backend` 使用设置页中的后端 API 地址 |
| `DEFAULT_API_BACKEND_BASE_URL` | 空 | 设置页“后端 API 地址”的初始值，例如 `https://backend.example.com/api` |

通过 `pnpm start` 或 Docker 注入数值配置时，请显式填写所需值。既未设置也未由 `.env.example` 补齐，或显式留空时，会写入空字符串，浏览器将其按 `0` 解析，再限制到表中范围的最小值。

用户已保存的设置会覆盖部署时的初始值。需要重新应用初始值时，在浏览器开发者工具中删除本站的 `localStorage` 项 `garupa-speed-tracker:preferences`，再刷新页面；这会清除该浏览器保存的偏好。

## 说明

- 当在设置页切换到后端 API 模式时，请输入你想要访问的完整 API 基址，例如 `http://backend.example.com/api` 或 `http://backend.example.com/api/v2`。
- 设置页只提供主主题色配置；按钮圆角和页面内边距统一集中在 `style/main.css` 中管理。
- 语言环境以中文优先，i18n 消息组织在 `src/i18n/messages` 下。

