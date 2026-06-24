/**
 * Viral engagement filter.
 *
 * Issue #8: a video passes if EITHER its view count is high enough OR its
 * like + engagement rate are high enough. Videos published within the last
 * 24 h are always passed (grace period) so brand-new uploads are not
 * prematurely excluded before their metrics mature.
 */

import type { TikTokVideoMeta } from './tiktok-client';

export interface ViralFilterConfig {
  /** Minimum absolute view count. */
  min_views: number;
  /** Minimum absolute like count (when paired with engagement rate). */
  min_likes: number;
  /** Minimum engagement rate = (likes + comments + shares) / views. */
  min_engagement_rate: number;
  /** Grace period in hours: videos newer than this always pass. */
  grace_period_hours: number;
}

export const DEFAULT_VIRAL_CONFIG: ViralFilterConfig = {
  min_views: 100_000,
  min_likes: 10_000,
  min_engagement_rate: 0.05,
  grace_period_hours: 24,
};

/** Compute engagement rate = (likes + comments + shares) / views. */
export function engagementRate(v: TikTokVideoMeta): number {
  if (!v.view_count || v.view_count <= 0) return 0;
  const interactions = v.like_count + v.comment_count + v.share_count;
  return interactions / v.view_count;
}

/** True if the video was published within the grace period. */
export function withinGracePeriod(
  v: TikTokVideoMeta,
  now: Date = new Date(),
  graceHours: number = DEFAULT_VIRAL_CONFIG.grace_period_hours,
): boolean {
  const published = Date.parse(v.published_at);
  if (Number.isNaN(published)) return false;
  const ageMs = now.getTime() - published;
  return ageMs >= 0 && ageMs <= graceHours * 60 * 60 * 1000;
}

/** Determine whether a single video passes the viral filter. */
export function passesViralFilter(
  v: TikTokVideoMeta,
  config: ViralFilterConfig = DEFAULT_VIRAL_CONFIG,
): boolean {
  if (withinGracePeriod(v, new Date(), config.grace_period_hours)) return true;

  const er = engagementRate(v);

  // OR logic: high views OR (high likes AND high engagement rate).
  if (v.view_count >= config.min_views) return true;
  if (v.like_count >= config.min_likes && er >= config.min_engagement_rate) {
    return true;
  }
  return false;
}

/** Filter a list, returning only the viral entries. */
export function applyViralFilter(
  videos: TikTokVideoMeta[],
  config: ViralFilterConfig = DEFAULT_VIRAL_CONFIG,
): TikTokVideoMeta[] {
  return videos.filter((v) => passesViralFilter(v, config));
}
