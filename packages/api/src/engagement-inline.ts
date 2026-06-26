/**
 * Engagement profile computation (inline copy for API package).
 *
 * The discovery package has the full version; this is a minimal copy so the
 * API can serve GET /api/engagement without a cross-package import.
 */
import { db } from '@nyxtok/shared';
import { readFile } from 'node:fs/promises';

export interface EngagementProfile {
  hashtagWeights: Map<string, number>;
  dislikedHashtags: Set<string>;
  likedCreators: Set<string>;
  likedKeywords: string[];
  likedCount: number;
  dismissedCount: number;
  bookmarkedCount: number;
  computedAt: Date;
}

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

export async function computeEngagementProfile(): Promise<EngagementProfile> {
  const rows = await db`
    SELECT hashtags, creator_handle, user_status, is_liked, is_bookmarked, transcript_path
    FROM videos
    WHERE is_liked = true OR is_bookmarked = true OR user_status = 'dismissed'
  ` as unknown as Array<{
    hashtags: string | null;
    creator_handle: string;
    user_status: string;
    is_liked: boolean;
    is_bookmarked: boolean;
    transcript_path: string | null;
  }>;

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
      const weight = row.is_liked ? 2 : 1;
      for (const tag of tags) {
        hashtagWeights.set(tag, (hashtagWeights.get(tag) ?? 0) + weight);
      }
      if (row.creator_handle && row.creator_handle !== '@unknown') {
        likedCreators.add(row.creator_handle.replace(/^@/, ''));
      }
      if (row.is_liked) likedCount++;
      if (row.is_bookmarked) bookmarkedCount++;

      if (row.transcript_path) {
        try {
          const content = await readFile(row.transcript_path, 'utf8');
          const body = content.replace(/^---[\s\S]*?---\n/, '');
          const words = body
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
          const freq = new Map<string, number>();
          for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
          const top = [...freq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([kw]) => kw);
          likedKeywords.push(...top);
        } catch { /* transcript file might not exist */ }
      }
    }

    if (row.user_status === 'dismissed') {
      dismissedCount++;
      for (const tag of tags) dislikedHashtags.add(tag);
    }
  }

  const keywordFreq = new Map<string, number>();
  for (const kw of likedKeywords) keywordFreq.set(kw, (keywordFreq.get(kw) ?? 0) + 1);
  const topKeywords = [...keywordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([kw]) => kw);

  return {
    hashtagWeights, dislikedHashtags, likedCreators,
    likedKeywords: topKeywords, likedCount, dismissedCount, bookmarkedCount,
    computedAt: new Date(),
  };
}
