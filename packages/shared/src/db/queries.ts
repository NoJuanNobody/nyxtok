// Query helpers for the `videos` table.
// Issue #2: upsert, feed, search, status update, and single-video lookup.

import { db } from './client';
import type { FeedOptions, FeedSort, Video } from '../types';

// ---------------------------------------------------------------------------
// Column allow-lists
// ---------------------------------------------------------------------------

/** All writable columns, in insertion order matching the table definition. */
const COLUMNS = [
  'video_id',
  'creator_handle',
  'creator_id',
  'caption',
  'hashtags',
  'view_count',
  'like_count',
  'share_count',
  'comment_count',
  'duration_seconds',
  'ai_relevance_score',
  'discovered_at',
  'published_at',
  'download_status',
  'download_error',
  'download_url',
  'thumbnail_url',
  'transcript_status',
  'transcript_error',
  'transcript_path',
  'validation_status',
  'validation_accuracy_score',
  'validation_claims_count',
  'validation_sources_count',
  'user_status',
  'is_liked',
  'is_bookmarked',
  'watch_later',
  'tags',
  'updated_at',
] as const;

type VideoColumn = (typeof COLUMNS)[number];

const UPDATABLE_COLUMNS = COLUMNS.filter((c) => c !== 'video_id');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick only known columns from an arbitrary partial object. */
function pickColumns(data: Partial<Video>): Partial<Record<VideoColumn, unknown>> {
  const out: Partial<Record<VideoColumn, unknown>> = {};
  for (const col of COLUMNS) {
    if (col in data && data[col as keyof Video] !== undefined) {
      out[col] = data[col as keyof Video];
    }
  }
  return out;
}

const SAFE_SORTS: Record<FeedSort, string> = {
  discovered_at: 'discovered_at DESC',
  ai_relevance_score: 'ai_relevance_score DESC',
  published_at: 'published_at DESC',
  view_count: 'view_count DESC',
};

// ---------------------------------------------------------------------------
// upsertVideo
// ---------------------------------------------------------------------------

/**
 * Insert a new video, or update all (non-key) columns of an existing one
 * with the same video_id. Returns the resulting row.
 */
export async function upsertVideo(data: Partial<Video>): Promise<Video> {
  if (!data.video_id) {
    throw new Error('upsertVideo: data.video_id is required');
  }

  const picked = pickColumns(data);
  // updated_at is always bumped on write.
  picked.updated_at = new Date();

  const keys = Object.keys(picked) as VideoColumn[];
  if (keys.length === 0) {
    throw new Error('upsertVideo: no valid columns provided');
  }

  const values = keys.map((k) => picked[k]);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const colList = keys.join(', ');

  // For ON CONFLICT update, reuse the same values for every column except video_id.
  const updateCols = keys.filter((k) => k !== 'video_id');
  const updateClause = updateCols
    .map((k) => `${k} = EXCLUDED.${k}`)
    .join(', ');

  const sql = `
    INSERT INTO videos (${colList})
    VALUES (${placeholders})
    ON CONFLICT (video_id) DO UPDATE SET ${updateClause}
    RETURNING *
  `;

  const rows = await db.unsafe<Video[]>(sql, values as never[]);
  return rows[0];
}

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------

/**
 * Paginated feed of videos with optional tag / relevance / status filters.
 */
export async function getFeed(
  options: FeedOptions,
): Promise<{ videos: Video[]; total_count: number }> {
  const {
    offset = 0,
    limit = 50,
    sort = 'discovered_at',
    filter_tags,
    min_relevance,
    exclude_statuses,
  } = options;

  const orderClause = SAFE_SORTS[sort] ?? SAFE_SORTS.discovered_at;

  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (min_relevance !== undefined) {
    idx += 1;
    where.push(`ai_relevance_score >= $${idx}`);
    params.push(min_relevance);
  }

  if (exclude_statuses && exclude_statuses.length > 0) {
    idx += 1;
    where.push(`user_status <> ALL($${idx})`);
    params.push(exclude_statuses);
  }

  if (filter_tags && filter_tags.length > 0) {
    // tags is semicolon-separated; match any requested tag as a whole element.
    idx += 1;
    where.push(
      `(tags IS NOT NULL AND string_to_array(tags, ';') && $${idx}::text[])`,
    );
    params.push(filter_tags.map((t) => t.trim()));
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total_count FROM videos ${whereClause}`;
  const countRows = await db.unsafe<{ total_count: number }[]>(
    countSql,
    params as never[],
  );
  const total_count = countRows[0]?.total_count ?? 0;

  idx += 1;
  const limitParam = `$${idx}`;
  params.push(limit);
  idx += 1;
  const offsetParam = `$${idx}`;
  params.push(offset);

  const listSql = `
    SELECT * FROM videos
    ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limitParam} OFFSET ${offsetParam}
  `;

  const videos = await db.unsafe<Video[]>(listSql, params as never[]);
  return { videos: [...videos], total_count };
}

// ---------------------------------------------------------------------------
// searchVideos
// ---------------------------------------------------------------------------

/**
 * ILIKE search over caption + hashtags + creator_handle.
 * Optionally filter by creator handle (exact match).
 */
export async function searchVideos(
  query: string,
  creator?: string,
  limit = 50,
): Promise<{ videos: Video[]; total_count: number }> {
  const trimmed = query.trim();
  const where: string[] = [];
  const params: unknown[] = [];
  let idx = 0;

  if (trimmed.length > 0) {
    idx += 1;
    where.push(
      `(caption ILIKE $${idx} OR hashtags ILIKE $${idx} OR creator_handle ILIKE $${idx})`,
    );
    params.push(`%${trimmed}%`);
  }

  if (creator && creator.trim().length > 0) {
    idx += 1;
    where.push(`creator_handle = $${idx}`);
    params.push(creator.trim());
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS total_count FROM videos ${whereClause}`;
  const countRows = await db.unsafe<{ total_count: number }[]>(
    countSql,
    params as never[],
  );
  const total_count = countRows[0]?.total_count ?? 0;

  idx += 1;
  const limitParam = `$${idx}`;
  params.push(limit);

  const listSql = `
    SELECT * FROM videos
    ${whereClause}
    ORDER BY discovered_at DESC
    LIMIT ${limitParam}
  `;

  const videos = await db.unsafe<Video[]>(listSql, params as never[]);
  return { videos: [...videos], total_count };
}

// ---------------------------------------------------------------------------
// updateVideoStatus
// ---------------------------------------------------------------------------

/**
 * Partial update of an existing video by video_id. Bumps updated_at.
 * Throws if the video does not exist.
 */
export async function updateVideoStatus(
  video_id: string,
  updates: Partial<Video>,
): Promise<Video> {
  const picked: Record<string, unknown> = {};
  for (const col of UPDATABLE_COLUMNS) {
    if (col in updates && updates[col as keyof Video] !== undefined) {
      picked[col] = updates[col as keyof Video];
    }
  }
  picked.updated_at = new Date();

  const keys = Object.keys(picked);
  if (keys.length === 0) {
    throw new Error('updateVideoStatus: no valid columns provided');
  }

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => picked[k]);
  const idParam = `$${keys.length + 1}`;

  const sql = `
    UPDATE videos SET ${setClause}
    WHERE video_id = ${idParam}
    RETURNING *
  `;

  const rows = await db.unsafe<Video[]>(sql, [...values, video_id] as never[]);
  if (rows.length === 0) {
    throw new Error(`updateVideoStatus: video not found: ${video_id}`);
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// failOrphanedInProgressJobs
// ---------------------------------------------------------------------------

/**
 * Reconcile orphaned pipeline jobs left in an `in_progress` state.
 *
 * The orchestrator's queue is in-memory, so a server restart (or crash) while
 * a pipeline was running leaves rows stuck at `transcript_status` /
 * `validation_status = 'in_progress'` with no worker to advance them. The UI
 * then shows a "Transcribing…" / "Validating…" pill forever.
 *
 * Called once at startup — when nothing is processing — so any `in_progress`
 * row is definitively orphaned and safe to mark `failed`. Returns the affected
 * video_ids for logging.
 */
export async function failOrphanedInProgressJobs(): Promise<string[]> {
  const rows = await db<Array<{ video_id: string }>>`
    UPDATE videos
    SET
      transcript_status = CASE
        WHEN transcript_status = 'in_progress' THEN 'failed'
        ELSE transcript_status END,
      transcript_error = CASE
        WHEN transcript_status = 'in_progress'
          THEN 'Pipeline interrupted (server restarted before completion)'
        ELSE transcript_error END,
      validation_status = CASE
        WHEN validation_status = 'in_progress' THEN 'failed'
        ELSE validation_status END,
      updated_at = now()
    WHERE transcript_status = 'in_progress' OR validation_status = 'in_progress'
    RETURNING video_id
  `;
  return rows.map((r) => r.video_id);
}

// ---------------------------------------------------------------------------
// deleteExpiredVideos
// ---------------------------------------------------------------------------

/**
 * Purge videos that have aged out of the retention window without engagement.
 *
 * Discovered videos are only kept for `retentionHours` (default 48) unless the
 * user has shown engagement — a like, bookmark, or watch-later save — in which
 * case the row is retained indefinitely. Everything else (untouched or merely
 * dismissed) is deleted once it is older than the window.
 *
 * Returns the deleted video_ids so callers can clean up on-disk artifacts
 * (downloaded mp4s, vault notes).
 */
export async function deleteExpiredVideos(
  retentionHours = 48,
): Promise<string[]> {
  const rows = await db<Array<{ video_id: string }>>`
    DELETE FROM videos
    WHERE discovered_at < now() - make_interval(hours => ${retentionHours})
      AND is_liked = false
      AND is_bookmarked = false
      AND watch_later = false
    RETURNING video_id
  `;
  return rows.map((r) => r.video_id);
}

// ---------------------------------------------------------------------------
// getVideo
// ---------------------------------------------------------------------------

/**
 * Fetch a single video by id, or null if not found.
 */
export async function getVideo(video_id: string): Promise<Video | null> {
  const rows = await db<Video[]>`SELECT * FROM videos WHERE video_id = ${video_id}`;
  return rows.length > 0 ? rows[0] : null;
}
