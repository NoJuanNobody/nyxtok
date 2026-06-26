/**
 * Main discovery loop.
 *
 * For each configured hashtag, search TikTok via the Python TikTokApi CLI
 * (playwright-based, avoids bot detection), apply the viral engagement filter
 * and AI relevance filter, then upsert survivors into the database.
 *
 * Optionally also monitors specific creators via yt-dlp if TIKTOK_CREATORS
 * is set.
 */

import { upsertVideo } from '@nyxtok/shared';
import type { Video } from '@nyxtok/shared';
import { TikTokClient, type TikTokVideoMeta } from './tiktok-client';
import { applyViralFilter, DEFAULT_VIRAL_CONFIG } from './viral-filter';
import { applyAiFilter } from './ai-filter';
import {
  computeEngagementProfile,
  getAdjustedHashtags,
  getAdjustedCreators,
  getAdjustedViralConfig,
  getExtraAiKeywords,
  type EngagementProfile,
} from './engagement';

/**
 * Hashtags searched (without leading #). Override via TIKTOK_HASHTAGS env var
 * (comma-separated).
 */
const DEFAULT_HASHTAGS: string[] = [
  'AI',
  'MachineLearning',
  'LLM',
  'GenAI',
  'AItutorial',
  'ChatGPT',
  'Midjourney',
  'DeepLearning',
  'NeuralNetworks',
  'ComputerVision',
  'NLP',
  'PromptEngineering',
];

/**
 * Optional: creators to also monitor via yt-dlp. Set via TIKTOK_CREATORS env
 * var (comma-separated handles, without @). Empty by default.
 */
const DEFAULT_CREATORS: string[] = [];

/** Parse hashtag list from env or fall back to defaults. */
function getHashtags(): string[] {
  const env = process.env.TIKTOK_HASHTAGS;
  if (env && env.trim()) {
    return env.split(',').map((h) => h.replace(/^#/, '').trim()).filter(Boolean);
  }
  return DEFAULT_HASHTAGS;
}

/** Parse creator list from env. */
function getCreators(): string[] {
  const env = process.env.TIKTOK_CREATORS;
  if (env && env.trim()) {
    return env.split(',').map((h) => h.replace(/^@/, '').trim()).filter(Boolean);
  }
  return DEFAULT_CREATORS;
}

/** Re-export the downloader for callers (e.g. index of package). */
export { downloadVideo } from './downloader';
/** Re-export the scheduler for callers. */
export { startScheduler } from './scheduler';

const client = new TikTokClient();

/**
 * Convert a TikTok metadata + AI score record into a partial Video row
 * suitable for upsertVideo.
 */
function toVideoRow(
  v: TikTokVideoMeta & { ai_score: number },
): Partial<Video> {
  return {
    video_id: v.video_id,
    creator_handle: v.creator_handle,
    creator_id: v.creator_id,
    caption: v.caption,
    hashtags: v.hashtags.join(';'),
    view_count: v.view_count,
    like_count: v.like_count,
    share_count: v.share_count,
    comment_count: v.comment_count,
    duration_seconds: v.duration_seconds,
    ai_relevance_score: v.ai_score,
    published_at: new Date(v.published_at),
    thumbnail_url: v.thumbnail_url,
    // Store the TikTok CDN URL so the stream endpoint can proxy it directly —
    // no need to download the video file to disk first.
    download_url: v.play_addr || null,
    download_status: v.play_addr ? 'completed' : 'pending',
    transcript_status: 'pending',
    validation_status: 'pending',
  };
}

/** Process a single hashtag: search, filter, enrich, store. */
async function processHashtag(
  hashtag: string,
  viralConfig?: { min_views: number; min_likes: number; min_engagement_rate: number },
): Promise<{ found: number; viral: number; stored: number }> {
  // Search via TikTokApi (playwright) — returns full engagement metrics.
  const found = await client.searchByHashtag(hashtag);

  // Deduplicate by video_id within this batch.
  const seen = new Set<string>();
  const unique = found.filter((v) => {
    if (!v.video_id || seen.has(v.video_id)) return false;
    seen.add(v.video_id);
    return true;
  });

  // Viral engagement filter (use adjusted config if provided).
  const viral = viralConfig
    ? unique.filter((v) => {
        // Inline viral filter with custom config
        const er = v.view_count > 0
          ? (v.like_count + v.comment_count + v.share_count) / v.view_count
          : 0;
        if (v.view_count >= viralConfig.min_views) return true;
        if (v.like_count >= viralConfig.min_likes && er >= viralConfig.min_engagement_rate) return true;
        return false;
      })
    : applyViralFilter(unique);

  // Enrich: fill in upload dates from yt-dlp (TikTokApi doesn't return them).
  const enriched: TikTokVideoMeta[] = [];
  for (const v of viral) {
    if (v.published_at && v.published_at !== new Date().toISOString()) {
      // Already have a valid date — keep as-is.
      enriched.push(v);
      continue;
    }
    if (v.url) {
      const full = await client.getVideoMeta(v.url);
      if (full) {
        // Merge: keep TikTokApi's engagement stats (more reliable), take yt-dlp's date.
        enriched.push({ ...v, published_at: full.published_at });
      } else {
        enriched.push(v);
      }
    } else {
      enriched.push(v);
    }
  }

  // AI relevance filter.
  const scored = await applyAiFilter(enriched);

  let stored = 0;
  for (const v of scored) {
    try {
      await upsertVideo(toVideoRow(v));
      stored += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] upsert failed for ${v.video_id} (#${hashtag}): ${msg}`);
    }
  }

  console.log(
    `[discovery] #${hashtag}: found=${unique.length} viral=${viral.length} stored=${stored}`,
  );
  return { found: unique.length, viral: viral.length, stored };
}

/** Process a single creator (supplementary to hashtag search). */
async function processCreator(
  handle: string,
  viralConfig?: { min_views: number; min_likes: number; min_engagement_rate: number },
): Promise<{ found: number; viral: number; stored: number }> {
  const found = await client.listCreatorVideos(handle);

  const seen = new Set<string>();
  const unique = found.filter((v) => {
    if (!v.video_id || seen.has(v.video_id)) return false;
    seen.add(v.video_id);
    return true;
  });

  const viral = viralConfig
    ? unique.filter((v) => {
        const er = v.view_count > 0
          ? (v.like_count + v.comment_count + v.share_count) / v.view_count
          : 0;
        if (v.view_count >= viralConfig.min_views) return true;
        if (v.like_count >= viralConfig.min_likes && er >= viralConfig.min_engagement_rate) return true;
        return false;
      })
    : applyViralFilter(unique);
  const scored = await applyAiFilter(viral);

  let stored = 0;
  for (const v of scored) {
    try {
      await upsertVideo(toVideoRow(v));
      stored += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] upsert failed for ${v.video_id} (@${handle}): ${msg}`);
    }
  }

  console.log(
    `[discovery] @${handle}: found=${unique.length} viral=${viral.length} stored=${stored}`,
  );
  return { found: unique.length, viral: viral.length, stored };
}

/**
 * Run a full discovery pass over all configured hashtags and creators.
 * Returns aggregate counts.
 */
export async function runDiscovery(): Promise<{
  total_found: number;
  total_viral: number;
  total_stored: number;
}> {
  const startedAt = new Date().toISOString();

  // Compute engagement profile from user's likes/dismissals/bookmarks.
  let profile: EngagementProfile | null = null;
  try {
    profile = await computeEngagementProfile();
    console.log(
      `[discovery] engagement profile: liked=${profile.likedCount} ` +
      `bookmarked=${profile.bookmarkedCount} dismissed=${profile.dismissedCount} ` +
      `likedHashtags=${profile.hashtagWeights.size} ` +
      `likedCreators=${profile.likedCreators.size} ` +
      `likedKeywords=${profile.likedKeywords.length}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[discovery] engagement profile failed (using defaults): ${msg}`);
  }

  // Adjust hashtags and creators based on engagement.
  const baseHashtags = getHashtags();
  const baseCreators = getCreators();
  const hashtags = profile
    ? getAdjustedHashtags(baseHashtags, profile)
    : baseHashtags;
  const creators = profile
    ? getAdjustedCreators(baseCreators, profile)
    : baseCreators;

  // Adjust viral filter thresholds based on engagement.
  const viralConfig = profile
    ? getAdjustedViralConfig(
        { min_views: DEFAULT_VIRAL_CONFIG.min_views, min_likes: DEFAULT_VIRAL_CONFIG.min_likes, min_engagement_rate: DEFAULT_VIRAL_CONFIG.min_engagement_rate },
        profile,
      )
    : { min_views: DEFAULT_VIRAL_CONFIG.min_views, min_likes: DEFAULT_VIRAL_CONFIG.min_likes, min_engagement_rate: DEFAULT_VIRAL_CONFIG.min_engagement_rate };

  // Extract extra AI keywords from liked transcripts.
  const extraKeywords = profile ? getExtraAiKeywords(profile) : [];
  if (extraKeywords.length > 0) {
    console.log(`[discovery] extra AI keywords from engagement: ${extraKeywords.join(', ')}`);
  }

  console.log(
    `[discovery] run starting at ${startedAt} ` +
    `(${hashtags.length} hashtags, ${creators.length} creators, ` +
    `min_views=${viralConfig.min_views}, min_likes=${viralConfig.min_likes})`,
  );

  let total_found = 0;
  let total_viral = 0;
  let total_stored = 0;

  // Phase 1: Hashtag search via TikTokApi.
  for (const tag of hashtags) {
    try {
      const r = await processHashtag(tag, viralConfig);
      total_found += r.found;
      total_viral += r.viral;
      total_stored += r.stored;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] hashtag #${tag} failed: ${msg}`);
    }
  }

  // Phase 2: Creator monitoring via yt-dlp (optional, supplementary).
  for (const handle of creators) {
    try {
      const r = await processCreator(handle, viralConfig);
      total_found += r.found;
      total_viral += r.viral;
      total_stored += r.stored;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] creator @${handle} failed: ${msg}`);
    }
  }

  console.log(
    `[discovery] run complete: found=${total_found} viral=${total_viral} stored=${total_stored}`,
  );
  return { total_found, total_viral, total_stored };
}

export { TikTokClient };
export type { TikTokVideoMeta };
