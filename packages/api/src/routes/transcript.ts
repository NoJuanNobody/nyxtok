/**
 * GET /api/videos/:video_id/transcript
 *
 * Returns transcript status, validation status/scores, and transcript path.
 * 404 if video not found.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo } from '@nyxtok/shared';
import type { ErrorResponse, TranscriptResponse } from '@nyxtok/shared';

export default async function transcriptRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { video_id: string } }>(
    '/api/videos/:video_id/transcript',
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

      const body: TranscriptResponse = {
        video_id,
        transcript_status: video.transcript_status,
        validation_status: video.validation_status,
        validation_accuracy_score: video.validation_accuracy_score,
        validation_claims_count: video.validation_claims_count,
        validation_sources_count: video.validation_sources_count,
        transcript_path: video.transcript_path,
        generated_at: video.transcript_path ? video.updated_at.toISOString() : null,
      };
      reply.send(body);
    },
  );
}
