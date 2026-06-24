import type { Video } from './video';

/** Paginated feed of videos for the home / discovery surface. */
export interface FeedResponse {
  videos: Video[];
  total_count: number;
  offset: number;
  limit: number;
}

/** Full-text / tag search results. */
export interface SearchResponse {
  videos: Video[];
  total_count: number;
}

/**
 * Response to a "like" action. Includes transcript status so the client
 * knows whether to render the transcript view.
 */
export interface LikeResponse {
  video_id: string;
  is_liked: boolean;
  transcript_status: string;
}

/** Response to a "bookmark" action. */
export interface BookmarkResponse {
  video_id: string;
  is_bookmarked: boolean;
  transcript_status: string;
  tags: string[];
}

/** Response to a "dismiss" action. */
export interface DismissResponse {
  video_id: string;
  user_status: string;
}

/** Liveness / dependency health check. */
export interface HealthResponse {
  status: string;
  db: string;
  storage: string;
}

/** Standard error envelope returned by all API error paths. */
export interface ErrorResponse {
  error: boolean;
  /** Machine-readable error code, e.g. `NOT_FOUND`, `VALIDATION_FAILED`. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Optional extra diagnostic detail. */
  details?: string;
}
