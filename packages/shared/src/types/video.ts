/**
 * Video domain types.
 *
 * The `Video` interface mirrors every column of the `videos` table defined in
 * `packages/shared/src/db/schema.sql`. Status columns use narrow string-union
 * types so callers can't assign out-of-domain values.
 *
 * Timestamps are `Date` (what postgres.js returns for `TIMESTAMP` columns).
 */

/** Lifecycle of downloading the video file to the vault. */
export type DownloadStatus = 'pending' | 'completed' | 'failed';

/** Lifecycle of transcript extraction. */
export type TranscriptStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Lifecycle of LLM-based claim validation. */
export type ValidationStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

/** Per-user disposition of a video in the feed. */
export type UserStatus = 'unwatched' | 'liked' | 'bookmarked' | 'dismissed';

/**
 * A single row in the `videos` table.
 *
 * Field names and order match `schema.sql` exactly.
 */
export interface Video {
  /** Stable primary key (TikTok video id). */
  video_id: string;
  /** TikTok `@creator` handle (without the leading @). */
  creator_handle: string;
  /** Internal creator id from TikTok. */
  creator_id: string;
  /** Video caption / on-screen text. */
  caption: string | null;
  /** Semicolon-separated hashtags. */
  hashtags: string | null;
  view_count: number;
  like_count: number;
  share_count: number;
  comment_count: number;
  /** Video duration in seconds. */
  duration_seconds: number;
  /** 0.00–1.00 inclusive — AI-assigned relevance score. */
  ai_relevance_score: number;
  /** When the row was inserted (DB `CURRENT_TIMESTAMP`). */
  discovered_at: Date;
  /** When the video was originally posted on TikTok. */
  published_at: Date;
  download_status: DownloadStatus;
  /** Last error from a failed download, if any. */
  download_error: string | null;
  /** Direct media URL used for downloading. */
  download_url: string | null;
  thumbnail_url: string | null;
  transcript_status: TranscriptStatus;
  /** Last error from a failed transcript pass, if any. */
  transcript_error: string | null;
  /** Path to the persisted transcript file in the vault. */
  transcript_path: string | null;
  validation_status: ValidationStatus;
  /** 0.00–1.00 accuracy score produced by validation. */
  validation_accuracy_score: number | null;
  validation_claims_count: number | null;
  validation_sources_count: number | null;
  user_status: UserStatus;
  is_liked: boolean;
  is_bookmarked: boolean;
  watch_later: boolean;
  /** Semicolon-separated user tags. */
  tags: string | null;
  /** When the row was last updated (DB `CURRENT_TIMESTAMP`). */
  updated_at: Date;
}

// --- Feed / query option types (used by the DB query helpers) ---

/** Sort keys supported by `getFeed`. */
export type FeedSort =
  | 'discovered_at'
  | 'ai_relevance_score'
  | 'published_at'
  | 'view_count';

/** Options accepted by `getFeed`. */
export interface FeedOptions {
  offset: number;
  limit: number;
  sort: FeedSort;
  /** Only return videos tagged with all of these (semicolon-split match against `tags`). */
  filter_tags?: string[];
  /** Minimum `ai_relevance_score` (0–1) inclusive. */
  min_relevance?: number;
  /** Exclude videos whose `user_status` is in this list. */
  exclude_statuses?: string[];
}
