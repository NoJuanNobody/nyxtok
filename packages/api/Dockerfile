# syntax=docker/dockerfile:1.6
#
# Nyxtok Fastify API — multi-stage build.
# Issue #20: produces a slim runtime image with ffmpeg and a built server bundle.
#

# ---------------------------------------------------------------------------
# Stage 1: build (install deps, bundle TypeScript with esbuild)
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

RUN corepack enable

WORKDIR /app

# Copy workspace manifests first for better layer caching.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/

# Install dependencies (frozen lockfile for reproducible builds).
RUN pnpm install --frozen-lockfile

# Copy source for shared + api.
COPY packages/shared packages/shared
COPY packages/api packages/api

# Bundle the API into a single self-contained CJS file at dist/index.js.
# esbuild inlines the @nyxtok/shared workspace source, so no node_modules are
# needed at runtime for the API.
RUN pnpm --filter @nyxtok/api build

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

# ffmpeg: audio extraction during transcription.
# yt-dlp: resolve fresh TikTok CDN URLs at stream time (self-contained binary).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Copy the bundled server.
COPY --from=builder /app/packages/api/dist/index.js /app/dist/index.js

# Persistent storage mount for the vault (transcripts, validation notes).
VOLUME ["/data"]

EXPOSE 3000

CMD ["node", "/app/dist/index.js"]
