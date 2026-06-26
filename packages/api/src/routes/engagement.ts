/**
 * GET /api/engagement
 *
 * Returns the user's engagement profile: liked/bookmarked/dismissed counts,
 * top hashtags by weight, liked creators, and extracted keywords from
 * liked transcripts. Used by the frontend to show "Recommended for you" info.
 */
import type { FastifyInstance } from 'fastify';
import { computeEngagementProfile } from '../discovery-proxy';

export default async function engagementRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/engagement', async (_req, reply) => {
    try {
      const profile = await computeEngagementProfile();

      const hashtagArray = [...profile.hashtagWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([tag, weight]) => ({ tag, weight }));

      reply.send({
        liked_count: profile.likedCount,
        bookmarked_count: profile.bookmarkedCount,
        dismissed_count: profile.dismissedCount,
        liked_hashtags: hashtagArray,
        liked_creators: [...profile.likedCreators],
        liked_keywords: profile.likedKeywords,
        disliked_hashtags: [...profile.dislikedHashtags],
        computed_at: profile.computedAt.toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.code(500).send({
        error: true,
        code: 'INTERNAL_ERROR',
        message: `Failed to compute engagement profile: ${msg}`,
      });
    }
  });
}
