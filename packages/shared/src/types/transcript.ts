import type { TranscriptStatus, ValidationStatus } from './video';

/** The result of extracting a transcript for a single video. */
export interface TranscriptResult {
  /** Full transcript text. */
  text: string;
  /** Number of words in `text`. */
  word_count: number;
  /** Where the transcript came from. */
  source: 'whisper' | 'captions';
}

/**
 * API response shape for a transcript request.
 *
 * Mirrors the transcript/validation columns on the `videos` table, with
 * `generated_at` / `error_message` surfaced as API-friendly aliases.
 */
export interface TranscriptResponse {
  video_id: string;
  transcript_status: TranscriptStatus;

  validation_status?: ValidationStatus;
  validation_accuracy_score?: number | null;
  validation_claims_count?: number | null;
  validation_sources_count?: number | null;

  transcript_path?: string | null;
  /** ISO-8601 timestamp of when the transcript was generated. */
  generated_at?: string | null;
  error_message?: string | null;
}
