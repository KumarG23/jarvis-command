# syntax=docker/dockerfile:1.7
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS build
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/read-proxy/package.json apps/read-proxy/package.json
COPY apps/command-proxy/package.json apps/command-proxy/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY apps/server/src apps/server/src
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/
COPY packages/contracts/src packages/contracts/src
RUN npm run build -w @jarvis-command/web \
 && npm run build -w @jarvis-command/server

FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS production-dependencies
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/read-proxy/package.json apps/read-proxy/package.json
COPY apps/command-proxy/package.json apps/command-proxy/package.json
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
 && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin jarvis-command \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=production-dependencies /workspace/node_modules node_modules
COPY --from=build /workspace/apps/server/dist/index.js apps/server/dist/index.js
COPY --from=build /workspace/apps/web/dist apps/web/dist
USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/index.js"]
