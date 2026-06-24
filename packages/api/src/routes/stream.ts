/**
 * GET /api/videos/:video_id/stream
 *
 * Serves the MP4 file from the video's download_url path using
 * fs.createReadStream. Supports HTTP Range requests for mobile playback.
 * 404 if video not found or no download_url / file missing.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo } from '@nyxtok/shared';
import type { ErrorResponse } from '@nyxtok/shared';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, basename } from 'node:path';

export default async function streamRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { video_id: string } }>(
    '/api/videos/:video_id/stream',
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

      if (!video.download_url) {
        const err: ErrorResponse = {
          error: true,
          code: 'NOT_FOUND',
          message: 'No download_url available for this video.',
        };
        return reply.code(404).send(err);
      }

      // download_url may be a local path or a URL. For streaming we use the
      // path portion as a local file path within the vault.
      let filePath: string;
      try {
        // If it's a URL, try to extract the path; otherwise treat as-is.
        if (video.download_url.startsWith('http')) {
          const url = new URL(video.download_url);
          filePath = decodeURIComponent(url.pathname);
        } else {
          filePath = video.download_url;
        }
        filePath = resolve(filePath);
      } catch {
        filePath = resolve(video.download_url);
      }

      // Verify the file exists and get its size.
      let fileSize: number;
      try {
        const stat = statSync(filePath);
        fileSize = stat.size;
      } catch {
        const err: ErrorResponse = {
          error: true,
          code: 'NOT_FOUND',
          message: 'Video file not found on disk.',
        };
        return reply.code(404).send(err);
      }

      // Determine content type from file extension.
      const ext = extname(filePath).toLowerCase();
      const contentType =
        ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';

      // --- Handle HTTP Range requests ---
      const rangeHeader = request.headers.range;
      if (rangeHeader) {
        // Parse: bytes=start-end
        const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
        if (match) {
          const startStr = match[1];
          const endStr = match[2];
          const start = startStr ? parseInt(startStr, 10) : 0;
          const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

          if (start >= fileSize || end >= fileSize || start > end) {
            reply.code(416).header('Content-Range', `bytes */${fileSize}`);
            return reply.send({
              error: true,
              code: 'RANGE_NOT_SATISFIABLE',
              message: 'Requested range not satisfiable.',
            });
          }

          const chunkSize = end - start + 1;
          const stream = createReadStream(filePath, { start, end });

          reply.code(206);
          reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          reply.header('Accept-Ranges', 'bytes');
          reply.header('Content-Length', chunkSize);
          reply.header('Content-Type', contentType);
          return reply.send(stream);
        }
      }

      // --- Full file response (no range) ---
      const stream = createReadStream(filePath);
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      reply.send(stream);
    },
  );
}
