/**
 * Engagement-based discovery signal extraction.
 *
 * Analyzes the user's likes, bookmarks, dismissals, and watch-later actions
 * to build an engagement profile that feeds back into the discovery loop:
 *
 *  - Liked/bookmarked hashtags get boosted search priority
 *  - Dismissed hashtags get deprioritized
 *  - Creators the user likes get added to the monitored list
 *  - Keywords from liked transcripts get added to the AI keyword whitelist
 *  - The viral filter thresholds get relaxed for topics the user engages with
 *
 * The profile is computed on each discovery run from the current DB state.
 */

import { db } from '@nyxtok/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngagementProfile {
  /** Hashtags that appear in liked/bookmarked videos, with frequency weights. */
  hashtagWeights: Map<string, number>;
  /** Hashtags from dismissed videos (negative signal). */
  dislikedHashtags: Set<string>;
  /** Creators the user has liked/bookmarked. */
  likedCreators: Set<string>;
  /** Keywords extracted from liked transcripts (for AI relevance boosting). */
  likedKeywords: string[];
  /** Number of liked videos. */
  likedCount: number;
  /** Number of dismissed videos. */
  dismissedCount: number;
  /** Number of bookmarked videos. */
  bookmarkedCount: number;
  /** Computed at. */
  computedAt: Date;
}

// ---------------------------------------------------------------------------
// DB query helper
// ---------------------------------------------------------------------------

interface EngagementRow {
  hashtags: string | null;
  creator_handle: string;
  user_status: string;
  is_liked: boolean;
  is_bookmarked: boolean;
  transcript_path: string | null;
}

async function fetchEngagementData(): Promise<EngagementRow[]> {
  const rows = await db<EngagementRow[]>`
    SELECT hashtags, creator_handle, user_status, is_liked, is_bookmarked, transcript_path
    FROM videos
    WHERE is_liked = true OR is_bookmarked = true OR user_status = 'dismissed'
  `;
  return rows as unknown as EngagementRow[];
}

// ---------------------------------------------------------------------------
// Keyword extraction from transcripts
// ---------------------------------------------------------------------------

/** Common stopwords to filter out when extracting keywords. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'some', 'any', 'few', 'more', 'most', 'other', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'so', 'than', 'too', 'very', 'just', 'also', 'like', 'basically',
  'literally', 'um', 'uh', 'er', 'ah', 'going', 'really', 'actually',
  'right', 'now', 'one', 'two', 'get', 'got', 'make', 'made', 'thing',
  'things', 'stuff', 'kind', 'sort', 'lot', 'bit', 'point', 'way',
]);

/**
 * Extract top keywords from transcript text.
 * Uses simple frequency analysis: tokenize, remove stopwords, count, take top N.
 */
export function extractKeywords(text: string, topN: number = 20): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }

  // Sort by frequency, return top N
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

// ---------------------------------------------------------------------------
// Profile computation
// ---------------------------------------------------------------------------

/**
 * Build an engagement profile from the current DB state.
 *
 * Called at the start of each discovery run to adjust search priorities.
 */
export async function computeEngagementProfile(): Promise<EngagementProfile> {
  const rows = await fetchEngagementData();

  const hashtagWeights = new Map<string, number>();
  const dislikedHashtags = new Set<string>();
  const likedCreators = new Set<string>();
  const likedKeywords: string[] = [];

  let likedCount = 0;
  let dismissedCount = 0;
  let bookmarkedCount = 0;

  for (const row of rows) {
    const tags = (row.hashtags ?? '')
      .split(';')
      .map((t) => t.replace(/^#/, '').trim().toLowerCase())
      .filter(Boolean);

    if (row.is_liked || row.is_bookmarked) {
      // Positive signal: +2 for likes, +1 for bookmarks
      const weight = row.is_liked ? 2 : 1;
      for (const tag of tags) {
        hashtagWeights.set(tag, (hashtagWeights.get(tag) ?? 0) + weight);
      }
      if (row.creator_handle && row.creator_handle !== '@unknown') {
        likedCreators.add(row.creator_handle.replace(/^@/, ''));
      }
      if (row.is_liked) likedCount++;
      if (row.is_bookmarked) bookmarkedCount++;

      // Extract keywords from transcript if available
      if (row.transcript_path) {
        try {
          const { readFile } = await import('node:fs/promises');
          const content = await readFile(row.transcript_path, 'utf8');
          // Strip YAML frontmatter, get body text
          const body = content.replace(/^---[\s\S]*?---\n/, '');
          const keywords = extractKeywords(body, 15);
          likedKeywords.push(...keywords);
        } catch {
          // Transcript file might not exist yet
        }
      }
    }

    if (row.user_status === 'dismissed') {
      dismissedCount++;
      for (const tag of tags) {
        dislikedHashtags.add(tag);
      }
    }
  }

  // Deduplicate liked keywords and sort by frequency
  const keywordFreq = new Map<string, number>();
  for (const kw of likedKeywords) {
    keywordFreq.set(kw, (keywordFreq.get(kw) ?? 0) + 1);
  }
  const topKeywords = [...keywordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([kw]) => kw);

  return {
    hashtagWeights,
    dislikedHashtags,
    likedCreators,
    likedKeywords: topKeywords,
    likedCount,
    dismissedCount,
    bookmarkedCount,
    computedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Discovery adjustments
// ---------------------------------------------------------------------------

/**
 * Compute the adjusted hashtag list for the next discovery run.
 *
 * Merges the default hashtags with liked hashtags (weighted by engagement).
 * Liked hashtags are prioritized (searched first, with relaxed thresholds).
 * Dismissed hashtags are deprioritized but not removed entirely.
 */
export function getAdjustedHashtags(
  defaults: string[],
  profile: EngagementProfile,
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  // Phase 1: Liked hashtags sorted by weight (highest engagement first)
  const liked = [...profile.hashtagWeights.entries()]
    .filter(([tag]) => !profile.dislikedHashtags.has(tag))
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  for (const tag of liked) {
    const normalized = tag.charAt(0).toUpperCase() + tag.slice(1);
    if (!seen.has(normalized.toLowerCase())) {
      result.push(normalized);
      seen.add(normalized.toLowerCase());
    }
  }

  // Phase 2: Default hashtags not already included
  for (const tag of defaults) {
    if (!seen.has(tag.toLowerCase())) {
      result.push(tag);
      seen.add(tag.toLowerCase());
    }
  }

  return result;
}

/**
 * Compute adjusted creators list: merge defaults with liked creators.
 */
export function getAdjustedCreators(
  defaults: string[],
  profile: EngagementProfile,
): string[] {
  const result = [...profile.likedCreators];
  for (const c of defaults) {
    if (!result.includes(c)) {
      result.push(c);
    }
  }
  return result;
}

/**
 * Compute an adjusted viral filter config based on engagement.
 *
 * If the user has liked many videos, relax thresholds slightly to surface
 * more niche content. If they've dismissed many, tighten thresholds.
 */
export function getAdjustedViralConfig(
  baseConfig: { min_views: number; min_likes: number; min_engagement_rate: number },
  profile: EngagementProfile,
): { min_views: number; min_likes: number; min_engagement_rate: number } {
  const totalActions = profile.likedCount + profile.dismissedCount;
  if (totalActions === 0) return baseConfig;

  const likeRatio = profile.likedCount / totalActions;
  const dismissRatio = profile.dismissedCount / totalActions;

  // If user likes more than they dismiss, relax thresholds (more permissive)
  // If user dismisses more, tighten (more selective)
  const adjustment = likeRatio - dismissRatio; // -1 to 1

  return {
    min_views: Math.max(10_000, Math.round(baseConfig.min_views * (1 - adjustment * 0.3))),
    min_likes: Math.max(1_000, Math.round(baseConfig.min_likes * (1 - adjustment * 0.3))),
    min_engagement_rate: Math.max(0.02, baseConfig.min_engagement_rate * (1 - adjustment * 0.2)),
  };
}

/**
 * Get extra AI keywords from liked transcripts to boost relevance scoring.
 */
export function getExtraAiKeywords(profile: EngagementProfile): string[] {
  // Filter to keywords that aren't already in the default whitelist
  // and look AI/tech-related
  return profile.likedKeywords.filter((kw) => {
    // Heuristic: keep keywords that look technical
    const techPatterns = [
      'ai', 'model', 'train', 'neural', 'learn', 'data', 'algorithm',
      'code', 'python', 'tensor', 'gpu', 'cloud', 'api', 'prompt',
      'generate', 'transformer', 'diffusion', 'image', 'video', 'audio',
      'language', 'text', 'chat', 'agent', 'tool', 'framework', 'library',
      'render', 'scene', 'animate', 'character', 'motion', 'style',
      'runway', 'midjourney', 'stable', 'diffusion', 'comfyui', 'openai',
      'anthropic', 'claude', 'gpt', 'llama', 'mistral', 'gemini',
      'hugging', 'face', 'replicate', 'automatic', 'regression',
      'classification', 'embedding', 'vector', 'fine', 'tune', 'lora',
      'quantiz', 'inference', 'deploy', 'server', 'scale', 'batch',
    ];
    return techPatterns.some((p) => kw.includes(p));
  });
}
