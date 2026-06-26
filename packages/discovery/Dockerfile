# syntax=docker/dockerfile:1.6
#
# Nyxtok discovery worker — multi-stage build.
# Issue #20: cron worker that searches TikTok, filters, and upserts videos.
# Final image includes yt-dlp and ffmpeg.
#

# ---------------------------------------------------------------------------
# Stage 1: build
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/discovery/package.json packages/discovery/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/discovery packages/discovery

# Bundle the worker into dist/main.js. @xenova/transformers is externalized
# (native/WASM model runtime) and resolved from node_modules at runtime.
RUN pnpm --filter @nyxtok/discovery build

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

# yt-dlp (TikTok search + caption fallback) and ffmpeg (audio extraction).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        yt-dlp \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy the bundled worker entrypoint.
COPY --from=builder /app/packages/discovery/dist/main.js /app/dist/main.js

# Copy node_modules so the externalized @xenova/transformers can be resolved.
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/packages/discovery/node_modules /app/packages/discovery/node_modules
COPY --from=builder /app/packages/shared/node_modules /app/packages/shared/node_modules

# Persistent storage for downloaded media / vault is provided at runtime by a
# Railway Volume mounted at /data (Railway rejects the Docker VOLUME instruction
# in favor of its managed volumes).

CMD ["node", "/app/dist/main.js"]
