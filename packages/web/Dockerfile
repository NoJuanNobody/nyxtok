# syntax=docker/dockerfile:1.6
#
# Nyxtok Next.js web frontend — multi-stage build.
# Issue #20: uses Next.js standalone output mode for a slim runtime image.
#

# ---------------------------------------------------------------------------
# Stage 1: build the Next.js app (standalone output)
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/web packages/web

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @nyxtok/web build

# ---------------------------------------------------------------------------
# Stage 2: runtime (standalone server)
# ---------------------------------------------------------------------------
FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# Next.js standalone output: server.js + .next/standalone + .next/static.
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

EXPOSE 3001

CMD ["node", "packages/web/server.js"]
