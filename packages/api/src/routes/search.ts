/**
 * GET /api/search
 *
 * Query params:
 *   q        (search string, optional)
 *   creator  (exact creator_handle match, optional)
 *   limit    (int, default 20, max 100)
 *
 * Returns SearchResponse.
 */
import type { FastifyInstance } from 'fastify';
import { searchVideos } from '@nyxtok/shared';
import type { ErrorResponse, SearchResponse } from '@nyxtok/shared';

export default async function searchRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/search', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    const q = query.q ?? '';
    const creator = query.creator;

    const limitRaw = query.limit ? parseInt(query.limit, 10) : 20;
    if (Number.isNaN(limitRaw) || limitRaw < 1) {
      const body: ErrorResponse = {
        error: true,
        code: 'VALIDATION_FAILED',
        message: 'limit must be a positive integer.',
      };
      return reply.code(400).send(body);
    }
    const limit = Math.min(limitRaw, 100);

    const { videos, total_count } = await searchVideos(q, creator, limit);

    const body: SearchResponse = {
      videos,
      total_count,
    };
    reply.send(body);
  });
}
