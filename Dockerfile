FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates g++ git make python3 \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build:service \
 && node -e "const Database = require('./dist/server/node_modules/better-sqlite3'); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close()" \
 && npm run verify:service-isolated

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data \
 && chown node:node /data

COPY --from=build --chown=node:node /app/dist/web ./dist/web
COPY --from=build --chown=node:node /app/dist/server ./dist/server
COPY --from=build --chown=node:node /app/LICENSE /app/README.md ./
COPY --from=build --chown=node:node /app/docs/server-web.md ./docs/server-web.md

ENV NODE_ENV=production \
    LX_HOST=0.0.0.0 \
    LX_PORT=3124 \
    LX_STORAGE_ROOT=/data \
    LX_WEB_ROOT=/app/dist/web \
    LX_SERVICE_NODE_MODULES=/app/dist/server/node_modules

USER node
EXPOSE 3124
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3124/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.cjs"]
