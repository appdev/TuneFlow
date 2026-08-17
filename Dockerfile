FROM node:24-bookworm-slim AS build

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

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /config /music /cache /tmp/tuneflow \
 && chown -R node:node /config /music /cache /tmp/tuneflow

COPY --from=build --chown=node:node /app/dist/web ./dist/web
COPY --from=build --chown=node:node /app/dist/server ./dist/server
COPY --from=build --chown=node:node /app/LICENSE /app/README.md ./
COPY --from=build --chown=node:node /app/docs/server-web.md ./docs/server-web.md

ENV NODE_ENV=production \
    TUNEFLOW_HOST=0.0.0.0 \
    TUNEFLOW_PORT=3124 \
    TUNEFLOW_CONFIG_ROOT=/config \
    TUNEFLOW_MEDIA_ROOT=/music \
    TUNEFLOW_CACHE_ROOT=/cache \
    TUNEFLOW_TEMP_ROOT=/tmp/tuneflow \
    TUNEFLOW_WEB_ROOT=/app/dist/web \
    TUNEFLOW_SERVICE_NODE_MODULES=/app/dist/server/node_modules

USER node
EXPOSE 3124
VOLUME ["/config", "/music"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3124/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.cjs"]
