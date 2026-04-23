# --- 阶段 1: 构建 ---
FROM node:22-alpine AS builder

# 安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY backend/package.json backend/pnpm-lock.yaml ./backend/

RUN pnpm install --frozen-lockfile --filter ./backend

COPY . .
RUN pnpm --filter ./backend build

# 运行缩小逻辑
RUN export PROJECT_ROOT=/app/backend/ && \
    node /app/backend/scripts/minify-docker.mjs && \
    rm -rf /app/backend/node_modules && \
    mv /app/backend/app-minimal/node_modules /app/backend/ && \
    rm -rf /app/backend/app-minimal

# --- 阶段 2: 运行 ---
FROM caomeiyouren/alpine-nodejs-minimize:1.0.0 AS runner
WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production \
    HOST=0.0.0.0

# 拷贝阶段 2 的产物
COPY --from=builder /app/backend ./

EXPOSE 5519
CMD ["node", "dist/index.js"]
