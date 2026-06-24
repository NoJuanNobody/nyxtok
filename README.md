# Nyxtok

Nyxtok is an AI-powered TikTok learning pipeline. It discovers AI/ML TikTok
content, downloads and transcribes the audio, extracts factual claims, runs
deep-research fact-checking against live web sources, and persists
Obsidian-style Markdown notes to a vault — all surfaced through a fast web UI.

---

## Table of contents

- [Architecture overview](#architecture-overview)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Railway deployment](#railway-deployment)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Vault note format](#vault-note-format)
- [Validation pipeline](#validation-pipeline)
- [Cost estimates](#cost-estimates)
- [Testing](#testing)

---

## Architecture overview

```
                         ┌─────────────────────────────────────────────┐
                         │                   Railway / Docker           │
                         │                                             │
   TikTok  ───────────▶  │  ┌─────────────────┐                        │
   (yt-dlp search)       │  │   discovery     │  cron every 6h         │
                         │  │  (node worker)   │                        │
                         │  │  viral + AI      │                        │
                         │  │  filters         │                        │
                         │  └────────┬─────────┘                        │
                         │           │ upsert                           │
                         │           ▼                                   │
                         │  ┌─────────────────┐    ┌──────────────────┐ │
                         │  │   PostgreSQL    │◀──▶│       api        │ │
                         │  │  (metadata DB)  │    │  (Fastify REST)  │ │
                         │  └─────────────────┘    └────────┬─────────┘ │
                         │           ▲                      │           │
                         │           │                      │ /api/*    │
                         │  ┌────────┴──────────────────────┴────────┐ │
                         │  │                web                       │ │
                         │  │            (Next.js SSR)                 │ │
                         │  └─────────────────────────────────────────┘ │
                         │           │                                   │
                         │           ▼                                   │
                         │  ┌─────────────────┐                        │
                         │  │     vault       │  /data/vault/*.md       │
                         │  │  (transcripts +  │  (Obsidian-compatible)  │
                         │  │  notes on disk)  │                        │
                         │  └─────────────────┘                        │
                         └─────────────────────────────────────────────┘
                                   ▲
                                   │ Groq API (Whisper + llama-3.3-70b)
                                   │ free tier
```

**Data flow:**

1. **Discovery** (`packages/discovery`) — a cron worker searches TikTok for
   AI/ML hashtags via the Python TikTokApi CLI (playwright-based, no MCP),
   applies a viral-engagement filter and an AI-relevance filter, then upserts
   survivors into Postgres. Hashtags are configurable via `TIKTOK_HASHTAGS`
   env var. Optionally monitors specific creators via yt-dlp.
2. **API** (`packages/api`) — a Fastify server exposes the feed, search,
   actions (like / bookmark / dismiss), transcript, and streaming endpoints.
   When a user **likes** a video, the API enqueues the full pipeline job.
3. **Pipeline** — `ffmpeg` extracts audio → **Groq Whisper** transcribes →
   claims are extracted → **deep research** fetches web sources → claims are
   classified → a **validation summary** is generated → a Markdown note is
   written to the vault.
4. **Web** (`packages/web`) — a Next.js app (feed, library, search) that
   proxies `/api/*` to the Fastify backend.

---

## Tech stack

| Layer        | Technology                                         |
| ------------ | -------------------------------------------------- |
| Monorepo     | pnpm workspaces, TypeScript 5.5                    |
| API          | Fastify 4, postgres.js, Node 20                    |
| Discovery    | node-cron, yt-dlp, @xenova/transformers (embeddings) |
| Web          | Next.js 14 (App Router), React 18, Tailwind CSS    |
| Database     | PostgreSQL 16                                      |
| Transcription| Groq Whisper (`whisper-large-v3`)                   |
| Validation   | Groq `llama-3.3-70b` chat completions              |
| Media        | ffmpeg (audio extraction), yt-dlp (search + fallback captions) |
| Deployment   | Docker (multi-stage), Railway                      |
| Testing      | Vitest                                             |

---

## Local development

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- (optional) Node 20 + pnpm 9 if you want to run services outside Docker

### One-command startup

```bash
# 1. Copy and edit env vars.
cp .env.example .env
#    Set GROQ_API_KEY (free at https://console.groq.com) and AUTH_TOKEN.

# 2. Build and run everything (postgres, api, discovery, web).
docker compose up --build
```

| Service    | URL                        |
| ---------- | -------------------------- |
| Web        | http://localhost:3001      |
| API        | http://localhost:3000      |
| Postgres   | localhost:5432             |

Postgres is initialised from `packages/shared/src/db/schema.sql` on first boot.
The vault and downloaded media persist in `./data` (mounted at `/data`).

### Running services individually (without Docker)

```bash
pnpm install

# Start a local Postgres (or use: docker compose up postgres)
# Apply the schema:
pnpm --filter @nyxtok/shared migrate   # or: psql $DATABASE_URL -f packages/shared/src/db/schema.sql

# Terminal 1: API
pnpm --filter @nyxtok/api dev

# Terminal 2: Discovery
pnpm --filter @nyxtok/discovery dev

# Terminal 3: Web
pnpm --filter @nyxtok/web dev
```

---

## Railway deployment

Nyxtok deploys to [Railway](https://railway.app) as four services. The
configuration lives in [`railway.json`](railway.json).

### Step-by-step

1. **Fork / push** this repository to GitHub.

2. **Create a new Railway project** and choose **Deploy from GitHub repo**.
   Railway detects `railway.json` and creates the four services
   (`nyxtok-api`, `nyxtok-discovery`, `nyxtok-web`, `postgresql`).

3. **Provision the Postgres plugin** — Railway auto-creates the `postgresql`
   service and exposes a `DATABASE_URL` variable. Reference it in the API and
   discovery services (Railway interpolates `${{Postgres.DATABASE_URL}}`).

4. **Set environment variables** for each service (see
   [Environment variables](#environment-variables) below). At minimum:

   | Service             | Variable            | Value                                 |
   | ------------------- | ------------------- | ------------------------------------- |
   | nyxtok-api          | `GROQ_API_KEY`      | your Groq key                         |
   | nyxtok-api          | `AUTH_TOKEN`         | a random bearer token                 |
   | nyxtok-api          | `VAULT_PATH`        | `/data/vault`                         |
   | nyxtok-discovery    | `GROQ_API_KEY`      | your Groq key                         |
   | nyxtok-discovery    | `AUTH_TOKEN`        | same as API                           |
   | nyxtok-discovery    | `VAULT_PATH`        | `/data/vault`                         |
   | nyxtok-web          | `NEXT_PUBLIC_API_URL` | the public API URL (e.g. `https://nyxtok-api.up.railway.app`) |

5. **Add a volume** to `nyxtok-api` and `nyxtok-discovery`, mounted at
   `/data`. This is where transcripts, media, and vault notes persist.

6. **Deploy** — Railway builds each service from its `Dockerfile` and starts it.
   The API health check is `GET /health`.

7. **Run migrations** — on first deploy, apply the schema:
   ```bash
   psql "$DATABASE_URL" -f packages/shared/src/db/schema.sql
   ```
   (Or use Railway's Postgres query console.)

8. **Set the discovery schedule** via `DISCOVERY_CRON` (default `0 */6 * * *` =
   every 6 hours). To run discovery once immediately, set
   `DISCOVERY_RUN_NOW=1` and redeploy the discovery service.

---

## Environment variables

| Variable                 | Required | Default            | Description                                                    |
| ------------------------ | :------: | ------------------ | -------------------------------------------------------------- |
| `DATABASE_URL`           | ✅       | —                  | Postgres connection string.                                    |
| `VAULT_PATH`             | ✅       | `/data/vault`      | Directory for Markdown vault notes + media.                    |
| `AUTH_TOKEN`             | ✅       | —                  | Bearer token for API auth (empty = disabled in dev).           |
| `TIKTOK_HASHTAGS`        |          | *(built-in list)*  | Comma-separated hashtags to search (without #).                |
| `TIKTOK_CREATORS`        |          | —                  | Optional: comma-separated creator handles to also monitor.      |
| `TIKTOK_SEARCH_LIMIT`    |          | `30`               | Max videos to request per hashtag per discovery run.            |
| `GROQ_API_KEY`           | 🔶       | —                  | Groq API key (Whisper + chat). Required for transcription.     |
| `WHISPER_SERVICE`        |          | `groq`             | Whisper backend: `groq` or `captions`.                        |
| `DISCOVERY_CRON`         |          | `0 */6 * * *`      | Cron schedule for the discovery loop.                          |
| `DISCOVERY_RUN_NOW`      |          | `0`                | `1` = run discovery once on boot then exit.                    |
| `VALIDATION_ENABLED`     |          | `true`             | Whether LLM claim-validation runs on new transcripts.          |
| `VALIDATION_MODEL`       |          | `llama-3.3-70b`    | Groq model id for claim extraction / classification / summary.  |
| `MAX_CLAIMS_PER_VIDEO`   |          | `30`               | Max claims extracted per video before validation.              |
| `VALIDATION_TIMEOUT`     |          | `180`              | Per-video validation timeout in seconds.                       |
| `PORT`                   |          | `3000`             | API server port.                                               |
| `HOST`                   |          | `0.0.0.0`          | API bind host.                                                 |
| `LOG_LEVEL`              |          | `info`             | pino log level.                                                |
| `NEXT_PUBLIC_API_URL`    |          | `http://localhost:3000` | Public API URL the browser uses.                          |
| `NYXTOK_API_URL`         |          | `http://localhost:3000` | Internal API URL the Next.js server proxies to.           |
| `POSTGRES_USER`          |          | `nyxtok`           | docker-compose Postgres user.                                  |
| `POSTGRES_PASSWORD`      |          | `nyxtok`           | docker-compose Postgres password.                              |
| `POSTGRES_DB`            |          | `nyxtok`           | docker-compose Postgres database.                              |
| `POSTGRES_DEBUG`          |          | `0`                | `1` = log SQL statements.                                       |

✅ = always required · 🔶 = required for the feature that uses it.

---

## API reference

All endpoints are under `/api` (except `/health`). Auth: `Authorization: Bearer <AUTH_TOKEN>` header when `AUTH_TOKEN` is set.

| #  | Method | Path                                   | Description                                                        |
| -- | ------ | -------------------------------------- | ------------------------------------------------------------------ |
| 1  | GET    | `/health`                              | Liveness probe: `{ status, db, storage }`. No auth.                |
| 2  | GET    | `/api/feed`                            | Paginated, filterable, sortable video feed.                       |
| 3  | GET    | `/api/search?q=&creator=&limit=`       | ILIKE search over caption + hashtags + creator_handle.             |
| 4  | POST   | `/api/videos/:video_id/like`           | Like a video; enqueues the transcript + validation pipeline.       |
| 5  | POST   | `/api/videos/:video_id/bookmark`       | Bookmark a video; merges `manual_tags` into `tags`.                 |
| 6  | POST   | `/api/videos/:video_id/dismiss`        | Dismiss a video (`user_status = dismissed`).                        |
| 7  | GET    | `/api/videos/:video_id/transcript`     | Transcript + validation status, scores, and file path.             |
| 8  | GET    | `/api/videos/:video_id/stream`         | Stream the MP4 with HTTP Range support for mobile playback.        |

### `/api/feed` query parameters

| Param             | Type   | Default       | Notes                                       |
| ----------------- | ------ | ------------- | ------------------------------------------- |
| `offset`          | int    | `0`           | Non-negative.                               |
| `limit`           | int    | `20` (max 100)| Positive.                                   |
| `sort`            | enum   | `discovered_at` | `discovered_at` \| `view_count` \| `ai_relevance_score` |
| `filter_tags`     | csv    | —             | Semicolon-separated tag match.              |
| `min_relevance`   | float  | —             | 0–1 inclusive.                              |
| `exclude_statuses`| csv    | `dismissed`   | Exclude these `user_status` values.         |

---

## Vault note format

Each processed video produces a Markdown file at `{VAULT_PATH}/{video_id}.md`
with YAML frontmatter and structured sections. The format is
Obsidian-compatible.

```markdown
---
title: "GPT-5 is coming and here is what we know"
creator: airesearcher
creator_id: "7012345678901234567"
tiktok_url: "https://www.tiktok.com/@airesearcher/video/7234567890123456789"
discovered_date: "2024-06-20T15:00:00.000Z"
published_date: "2024-06-20T14:30:00.000Z"
duration_seconds: 58
view_count: 1250000
like_count: 245000
share_count: 18200
ai_relevance_score: 0.9
tags: [AI, MachineLearning, LLM, GPT]
vault_created_at: "2024-06-24T12:00:00.000Z"
vault_transcript_source: whisper
validation_status: completed
validation_accuracy_score: 50
validation_claims_count: 1
validation_sources_count: 1
---

# GPT-5 is coming and here is what we know

By [@airesearcher](https://www.tiktok.com/@airesearcher)

## Key Points

- So GPT-5 is reportedly going to be released by the end of this year.
- The model is said to use a new training approach called process reward models.

## Transcript

*Source: whisper (84 words)*

So GPT-5 is reportedly going to be released by the end of this year...

## Deep Research Validation

### Summary

**Accuracy score: 50%** across 1 claim(s).

The video's primary claim about GPT-5's release timeline was verified against
multiple sources.

### Claim-by-Claim

### claim-1: verified

> GPT-5 will be released by the end of the year.

- **Source:** https://example.com/openai-gpt5
- **Evidence:** OpenAI confirmed the release timeline in a recent interview...
- **Notes:** Corroborated by multiple sources.

### Sources

- https://example.com/openai-gpt5

### Corrections & Gaps

- No contradictions found.

## Notes

<!-- Add your own notes here -->
```

---

## Validation pipeline

When a user **likes** a video, the orchestrator (`packages/api/src/pipeline`)
runs the full pipeline with a concurrency cap of 3:

```
like ──▶ enqueue ──▶ [1] ffmpeg audio extract
                     [2] Groq Whisper transcription (retry 2×, 2-5 min backoff)
                         └ fallback: yt-dlp TikTok auto-captions
                     [3] extract claims (Groq llama-3.3-70b, JSON output)
                     [4] deep research per claim (DuckDuckGo → fetch → extract)
                     [5] classify claims (verified / partially / contradicted / unverifiable)
                     [6] validation summary (Groq) + persist accuracy/scores to DB
                     [7] write vault Markdown note
```

- Each step updates `transcript_status` / `validation_status` in the DB, so
  partial results survive failures.
- Claims are capped at `MAX_CLAIMS_PER_VIDEO` (default 30).
- Deep research fetches up to 5 source URLs per claim, truncates evidence to
  ~6000 chars, and runs 3 claims concurrently.
- The overall validation batch is bounded by `VALIDATION_TIMEOUT` (180 s); on
  timeout, partial results are saved.
- Tags are auto-assigned from hashtags matched against an AI/tech taxonomy and
  merged with user-added tags.

---

## Cost estimates

### Railway (infrastructure)

| Service             | Plan     | Approx. monthly cost |
| ------------------- | -------- | -------------------- |
| nyxtok-api           | Starter  | ~$5                  |
| nyxtok-discovery    | Starter  | ~$2                  |
| nyxtok-web          | Starter  | ~$2                  |
| Postgres (plugin)   | Starter  | ~$1                  |
| Volume (1 GB)       | included | $0                   |
| **Total**           |          | **~$8–11/month**     |

### Groq (tokens)

- **Whisper** (`whisper-large-v3`): free tier covers the discovery volume
  (~minutes of audio per liked video).
- **Chat** (`llama-3.3-70b`): free tier covers claim extraction,
  classification, and summaries.
- **Estimated token cost: ~$0/month** on the Groq free tier.

> At typical usage (a few hundred videos/month, a handful liked per day) the
> pipeline stays well within Groq's free tier.

---

## Testing

Tests use [Vitest](https://vitest.dev/) and run without a live database or
external services (DB and Groq layers are mocked).

```bash
# Install deps (adds vitest + esbuild).
pnpm install

# Run all tests once.
pnpm test

# Watch mode.
pnpm test:watch
```

### Test suites

| File                                       | Coverage                                                    |
| ------------------------------------------ | ----------------------------------------------------------- |
| `packages/api/test/feed.test.ts`           | GET /api/feed: pagination, limit/offset, dismissed exclusion, 400s |
| `packages/api/test/actions.test.ts`        | like / bookmark / dismiss: status updates, tag merge, 404s |
| `packages/api/test/pipeline.test.ts`       | Pipeline: mock Groq, vault file structure, DB status updates |
| `packages/discovery/test/filter.test.ts`   | Viral filter pass/fail, AI keyword scoring thresholds       |

Mock data fixtures live in `packages/api/test/fixtures/`.

---

## License

Private / Proprietary.
