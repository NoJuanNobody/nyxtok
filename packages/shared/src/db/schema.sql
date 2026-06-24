-- Nyxtok — videos table schema
-- Issue #2: PostgreSQL database schema and DB client
--
-- This file is executed by packages/api/src/migrate.ts against DATABASE_URL.
-- It is idempotent: uses CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS videos (
  video_id                   VARCHAR(255) PRIMARY KEY NOT NULL,
  creator_handle             VARCHAR(255) NOT NULL,
  creator_id                 VARCHAR(255) NOT NULL,
  caption                    TEXT,
  hashtags                   TEXT,                                  -- semicolon-separated
  view_count                 INTEGER      NOT NULL DEFAULT 0,
  like_count                 INTEGER      NOT NULL DEFAULT 0,
  share_count                INTEGER      NOT NULL DEFAULT 0,
  comment_count              INTEGER      NOT NULL DEFAULT 0,
  duration_seconds           INTEGER      NOT NULL,
  ai_relevance_score         DECIMAL(3,2) NOT NULL CHECK (ai_relevance_score >= 0 AND ai_relevance_score <= 1),
  discovered_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at               TIMESTAMP    NOT NULL,
  download_status            VARCHAR(50)  NOT NULL DEFAULT 'pending',
  download_error             TEXT,
  download_url               VARCHAR(2048),
  thumbnail_url              VARCHAR(2048),
  transcript_status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
  transcript_error           TEXT,
  transcript_path            VARCHAR(2048),
  validation_status          VARCHAR(50)  NOT NULL DEFAULT 'pending',
  validation_accuracy_score  DECIMAL(3,2),
  validation_claims_count    INTEGER,
  validation_sources_count   INTEGER,
  user_status                VARCHAR(50)  NOT NULL DEFAULT 'unwatched',
  is_liked                   BOOLEAN      NOT NULL DEFAULT false,
  is_bookmarked              BOOLEAN      NOT NULL DEFAULT false,
  watch_later                BOOLEAN      NOT NULL DEFAULT false,
  tags                       TEXT,                                  -- semicolon-separated
  updated_at                 TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes -----------------------------------------------------------------

CREATE INDEX        IF NOT EXISTS idx_discovered_at     ON videos(discovered_at DESC);
CREATE INDEX        IF NOT EXISTS idx_user_status       ON videos(user_status);
CREATE INDEX        IF NOT EXISTS idx_ai_relevance_score ON videos(ai_relevance_score DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_id          ON videos(video_id);
CREATE INDEX        IF NOT EXISTS idx_is_liked          ON videos(is_liked);
CREATE INDEX        IF NOT EXISTS idx_is_bookmarked     ON videos(is_bookmarked);
CREATE INDEX        IF NOT EXISTS idx_watch_later       ON videos(watch_later);
