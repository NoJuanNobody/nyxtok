/**
 * POST /api/videos/:video_id/bookmark
 *
 * Body: { manual_tags?: string[], action?: 'unbookmark' }
 * Sets is_bookmarked=true (or false if action='unbookmark').
 * Merges manual_tags into the video's tags column.
 * Returns BookmarkResponse.
 * 404 if video not found.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo, updateVideoStatus } from '@nyxtok/shared';
import type { BookmarkResponse, ErrorResponse } from '@nyxtok/shared';

export default async function bookmarkRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: { video_id: string } }>(
    '/api/videos/:video_id/bookmark',
    async (request, reply) => {
      const { video_id } = request.params;
      const body = (request.body ?? {}) as {
        manual_tags?: string[];
        action?: string;
      };

      const video = await getVideo(video_id);
      if (!video) {
        const err: ErrorResponse = {
          error: true,
          code: 'NOT_FOUND',
          message: `Video not found: ${video_id}`,
        };
        return reply.code(404).send(err);
      }

      const unbookmark = body.action === 'unbookmark';

      // Merge tags: parse existing semicolon-separated tags, add new ones.
      let mergedTags: string[] = [];
      if (!unbookmark) {
        const existing = (video.tags ?? '')
          .split(';')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const incoming = (body.manual_tags ?? []).map((t) => t.trim()).filter(
          (t) => t.length > 0,
        );
        mergedTags = [...new Set([...existing, ...incoming])];
      }

      const updated = await updateVideoStatus(video_id, {
        is_bookmarked: !unbookmark,
        user_status: unbookmark ? video.user_status : 'bookmarked',
        tags: mergedTags.length > 0 ? mergedTags.join(';') : video.tags,
      });

      const resTags = (updated.tags ?? '')
        .split(';')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      const res: BookmarkResponse = {
        video_id,
        is_bookmarked: updated.is_bookmarked,
        transcript_status: updated.transcript_status,
        tags: resTags,
      };
      reply.send(res);
    },
  );
}
