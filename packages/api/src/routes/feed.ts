/**
 * GET /api/feed — paginated, filterable, sortable video feed.
 *
 * Query params:
 *   offset            (int, default 0)
 *   limit             (int, default 20, max 100)
 *   sort              (discovered_at | view_count | ai_relevance_score, default discovered_at)
 *   filter_tags       (comma-separated, optional)
 *   min_relevance     (float 0–1, optional)
 *   exclude_statuses  (comma-separated, default 'dismissed')
 */
import type { FastifyInstance } from 'fastify';
import { getFeed } from '@nyxtok/shared';
import type {
  ErrorResponse,
  FeedResponse,
  FeedSort,
} from '@nyxtok/shared';

const VALID_SORTS = new Set<FeedSort>([
  'discovered_at',
  'view_count',
  'ai_relevance_score',
]);

export default async function feedRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/api/feed', async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;

    // --- offset ---
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    if (Number.isNaN(offset) || offset < 0) {
      const body: ErrorResponse = {
        error: true,
        code: 'VALIDATION_FAILED',
        message: 'offset must be a non-negative integer.',
      };
      return reply.code(400).send(body);
    }

    // --- limit ---
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

    // --- sort ---
    const sortRaw = (query.sort ?? 'discovered_at') as FeedSort;
    if (!VALID_SORTS.has(sortRaw)) {
      const body: ErrorResponse = {
        error: true,
        code: 'VALIDATION_FAILED',
        message: `sort must be one of: ${[...VALID_SORTS].join(', ')}.`,
      };
      return reply.code(400).send(body);
    }

    // --- filter_tags ---
    let filter_tags: string[] | undefined;
    if (query.filter_tags) {
      filter_tags = query.filter_tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    }

    // --- min_relevance ---
    let min_relevance: number | undefined;
    if (query.min_relevance !== undefined) {
      min_relevance = parseFloat(query.min_relevance);
      if (Number.isNaN(min_relevance) || min_relevance < 0 || min_relevance > 1) {
        const body: ErrorResponse = {
          error: true,
          code: 'VALIDATION_FAILED',
          message: 'min_relevance must be a float between 0 and 1.',
        };
        return reply.code(400).send(body);
      }
    }

    // --- exclude_statuses ---
    const exclude_statuses = query.exclude_statuses
      ? query.exclude_statuses
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : ['dismissed'];

    // --- query DB ---
    const { videos, total_count } = await getFeed({
      offset,
      limit,
      sort: sortRaw,
      filter_tags,
      min_relevance,
      exclude_statuses,
    });

    const body: FeedResponse = {
      videos,
      total_count,
      offset,
      limit,
    };
    reply.send(body);
  });
}
