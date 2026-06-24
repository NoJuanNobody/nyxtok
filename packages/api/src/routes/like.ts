/**
 * POST /api/videos/:video_id/like
 *
 * Sets is_liked=true (or false if body.action === 'unlike').
 * Enqueues a transcript job if transcript_status is 'pending'.
 * Returns LikeResponse.
 * 404 if video not found.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo, updateVideoStatus } from '@nyxtok/shared';
import type { ErrorResponse, LikeResponse } from '@nyxtok/shared';
import { enqueueTranscriptJob } from '../queue';

export default async function likeRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post<{ Params: { video_id: string } }>(
    '/api/videos/:video_id/like',
    async (request, reply) => {
      const { video_id } = request.params;
      const body = (request.body ?? {}) as { action?: string };

      const video = await getVideo(video_id);
      if (!video) {
        const err: ErrorResponse = {
          error: true,
          code: 'NOT_FOUND',
          message: `Video not found: ${video_id}`,
        };
        return reply.code(404).send(err);
      }

      const unlike = body.action === 'unlike';

      const updated = await updateVideoStatus(video_id, {
        is_liked: !unlike,
        user_status: unlike ? 'unwatched' : 'liked',
      });

      // Enqueue transcript job if liking and transcript is still pending.
      if (!unlike && updated.transcript_status === 'pending') {
        enqueueTranscriptJob(video_id);
      }

      const res: LikeResponse = {
        video_id,
        is_liked: updated.is_liked,
        transcript_status: updated.transcript_status,
      };
      reply.send(res);
    },
  );
}
