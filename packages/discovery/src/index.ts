/**
 * Main discovery loop.
 *
 * Issue #8: for each hashtag / keyword, search TikTok via yt-dlp, apply the
 * viral engagement filter, apply the AI relevance filter, and upsert the
 * survivors into the database. Logs progress for each search term.
 */

import { upsertVideo } from '@nyxtok/shared';
import type { Video } from '@nyxtok/shared';
import { TikTokClient, type TikTokVideoMeta } from './tiktok-client';
import { applyViralFilter } from './viral-filter';
import { applyAiFilter } from './ai-filter';

/** Hashtags searched (without leading #). */
export const SEARCH_HASHTAGS: string[] = [
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

/** Process a single search term (hashtag or keyword). */
async function processTerm(
  kind: 'hashtag' | 'keyword',
  term: string,
): Promise<{ found: number; viral: number; stored: number }> {
  const label = kind === 'hashtag' ? `#${term}` : `"${term}"`;

  let found: TikTokVideoMeta[];
  if (kind === 'hashtag') {
    found = await client.searchByHashtag(term);
  } else {
    found = await client.searchByKeyword(term);
  }

  // Deduplicate by video_id within this batch.
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
      console.error(`[discovery] upsert failed for ${v.video_id} (${label}): ${msg}`);
    }
  }

  console.log(
    `[discovery] ${label}: found=${unique.length} viral=${viral.length} stored=${stored}`,
  );
  return { found: unique.length, viral: viral.length, stored };
}

/**
 * Run a full discovery pass over all configured hashtags and keywords.
 * Returns aggregate counts.
 */
export async function runDiscovery(): Promise<{
  total_found: number;
  total_viral: number;
  total_stored: number;
}> {
  const startedAt = new Date().toISOString();
  console.log(`[discovery] run starting at ${startedAt}`);

  let total_found = 0;
  let total_viral = 0;
  let total_stored = 0;

  for (const tag of SEARCH_HASHTAGS) {
    try {
      const r = await processTerm('hashtag', tag);
      total_found += r.found;
      total_viral += r.viral;
      total_stored += r.stored;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] hashtag #${tag} failed: ${msg}`);
    }
  }

  console.log(
    `[discovery] run complete: found=${total_found} viral=${total_viral} stored=${total_stored}`,
  );
  return { total_found, total_viral, total_stored };
}

export { TikTokClient };
export type { TikTokVideoMeta };
