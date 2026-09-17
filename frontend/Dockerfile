# --- 阶段 1: 构建 ---
FROM node:22-alpine AS builder

# 与 package.json 的 packageManager 保持一致，避免自动切换版本时缺少 Alpine 原生二进制
RUN npm install -g pnpm@10.28.2

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/pnpm-lock.yaml ./frontend/

RUN pnpm install --frozen-lockfile --filter ./frontend

COPY . .
RUN pnpm --filter ./frontend build

# --- 阶段 2: 运行 ---
FROM nginx:alpine-slim AS runner

# 将 PID 文件位置改到 /tmp，并确保 nginx 用户对缓存和日志目录有权限
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf && \
    sed -i 's|/run/nginx.pid|/tmp/nginx.pid|g' /etc/nginx/nginx.conf && \
    chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d

# 拷贝静态产物
COPY --from=builder --chown=nginx:nginx /app/frontend/dist /usr/share/nginx/html

# 拷贝模板
COPY --chown=nginx:nginx frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chown=nginx:nginx frontend/docker-entrypoint.d/99-runtime-config.sh /docker-entrypoint.d/99-runtime-config.sh

RUN chmod +x /docker-entrypoint.d/99-runtime-config.sh

USER nginx

EXPOSE 5913
ENV BACKEND_API_URL=http://grp-speed-backend:5519/api
