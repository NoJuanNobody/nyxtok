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
import { applyViralFilter } from './viral-filter';
import { applyAiFilter } from './ai-filter';

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
    download_status: 'pending',
    transcript_status: 'pending',
    validation_status: 'pending',
  };
}

/** Process a single hashtag: search, filter, enrich, store. */
async function processHashtag(
  hashtag: string,
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

  // Viral engagement filter.
  const viral = applyViralFilter(unique);

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
): Promise<{ found: number; viral: number; stored: number }> {
  const found = await client.listCreatorVideos(handle);

  const seen = new Set<string>();
  const unique = found.filter((v) => {
    if (!v.video_id || seen.has(v.video_id)) return false;
    seen.add(v.video_id);
    return true;
  });

  const viral = applyViralFilter(unique);
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
  const hashtags = getHashtags();
  const creators = getCreators();
  console.log(`[discovery] run starting at ${startedAt} (${hashtags.length} hashtags, ${creators.length} creators)`);

  let total_found = 0;
  let total_viral = 0;
  let total_stored = 0;

  // Phase 1: Hashtag search via TikTokApi.
  for (const tag of hashtags) {
    try {
      const r = await processHashtag(tag);
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
      const r = await processCreator(handle);
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
