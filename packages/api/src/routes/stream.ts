/**
 * GET /api/videos/:video_id/stream
 *
 * Streams the video file to the browser. Supports two modes:
 *
 * 1. **Remote CDN URL** — if `download_url` starts with `http`, proxy the
 *    remote TikTok CDN URL through this server (supports HTTP Range requests
 *    for seeking). This is the default path: discovery stores the CDN URL
 *    directly so no download-to-disk is needed.
 *
 * 2. **Local file** — if `download_url` is a local path, stream from disk
 *    using fs.createReadStream (also supports Range requests).
 *
 * 404 if video not found or no download_url / file missing.
 */
import type { FastifyInstance } from 'fastify';
import { getVideo } from '@nyxtok/shared';
import type { ErrorResponse } from '@nyxtok/shared';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { ensureLocalVideo, tiktokPageUrl } from './stream-resolver';

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

      // --- Resolve a local, playable file path ----------------------------
      // Proxying TikTok CDN URLs directly fails (playAddr URLs are signed and
      // session/cookie-bound, so the server gets 403/404). Serve from disk
      // instead: reuse an existing local download if present, else fetch the
      // file on demand with yt-dlp (which replays the right auth headers).
      let filePath: string;
      const localCandidate =
        video.download_url && !video.download_url.startsWith('http')
          ? resolve(video.download_url)
          : null;

      if (localCandidate && existsSync(localCandidate)) {
        filePath = localCandidate;
      } else {
        if (!video.creator_handle) {
          const err: ErrorResponse = {
            error: true,
            code: 'NOT_FOUND',
            message: 'Cannot stream: missing creator handle to locate video.',
          };
          return reply.code(404).send(err);
        }

        const pageUrl = tiktokPageUrl(video.creator_handle, video.video_id);
        try {
          filePath = await ensureLocalVideo(video.video_id, pageUrl);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[stream] ${video.video_id}: download failed: ${msg}`);
          const body: ErrorResponse = {
            error: true,
            code: 'STREAM_UNAVAILABLE',
            message: 'Could not fetch this video (it may be private or removed).',
          };
          return reply.code(502).send(body);
        }
      }

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

      const ext = extname(filePath).toLowerCase();
      const contentType =
        ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';

      const rangeHeader = request.headers.range;
      if (rangeHeader) {
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

      const stream = createReadStream(filePath);
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      reply.send(stream);
    },
  );
}
