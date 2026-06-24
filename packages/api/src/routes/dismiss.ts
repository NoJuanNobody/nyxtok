/**
 * POST /api/videos/:video_id/dismiss
 *
 * Sets user_status='dismissed'.
 * Returns DismissResponse.
 * 404 if video not found.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo, updateVideoStatus } from '@nyxtok/shared';
import type { DismissResponse, ErrorResponse } from '@nyxtok/shared';

export default async function dismissRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: { video_id: string } }>(
    '/api/videos/:video_id/dismiss',
    async (request, reply) => {
      const { video_id } = request.params;

      const video = await getVideo(video_id);
      if (!video) {
        const err: ErrorResponse = {
          error: true,
          code: 'NOT_FOUND',
          message: `Video not found: ${video_id}`,
        };
        return reply.code(404).send(err);
      }

      const updated = await updateVideoStatus(video_id, {
        user_status: 'dismissed',
      });

      const res: DismissResponse = {
        video_id,
        user_status: updated.user_status,
      };
      reply.send(res);
    },
  );
}
