# Nyxtok

Nyxtok is an AI-powered TikTok learning pipeline. It discovers TikTok content, extracts and transcribes video data, and uses LLM-based validation to surface high-signal claims and insights.

## Monorepo Structure

This repository is organized as a pnpm monorepo with the following packages:

| Package | Description |
|---------|-------------|
| `packages/shared` | Shared types, utilities, and constants used across all packages |
| `packages/api` | Backend API server exposing REST endpoints for querying videos, claims, and validation results |
| `packages/discovery` | Discovery pipeline that crawls TikTok content on a schedule, downloads metadata, and enqueues videos for processing |
| `packages/web` | Next.js web frontend for browsing and searching the knowledge base |

## Prerequisites

- **Node.js** >= 20
- **pnpm** >= 9
- **PostgreSQL** for the metadata database

## Getting Started

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your actual values (API keys, database URL, etc.).

3. **Run development servers:**

   ```bash
   pnpm dev
   ```

## Environment Variables

See [`.env.example`](.env.example) for the full list of configuration options and their descriptions.

## License

Private / Proprietary
