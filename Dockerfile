# syntax=docker/dockerfile:1.7
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/read-proxy/package.json apps/read-proxy/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build -w @jarvis-command/web \
 && npm run build -w @jarvis-command/server

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS production-dependencies
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/read-proxy/package.json apps/read-proxy/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace @jarvis-command/server --include-workspace-root=false \
 && rm -rf node_modules/@jarvis-command

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS runtime
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=3000 \
    WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app

RUN groupadd --gid 10001 jarvis-command \
 && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin jarvis-command
COPY --from=production-dependencies /workspace/node_modules node_modules
COPY --from=build --chown=10001:10001 /workspace/apps/server/dist apps/server/dist
COPY --from=build --chown=10001:10001 /workspace/apps/web/dist apps/web/dist
USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
