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
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

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

      // --- Remote CDN URL: proxy through this server ----------------------
      if (video.download_url.startsWith('http')) {
        return proxyRemoteVideo(video.download_url, request, reply);
      }

      // --- Local file path ------------------------------------------------
      let filePath: string;
      try {
        filePath = resolve(video.download_url);
      } catch {
        filePath = resolve(video.download_url);
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

/**
 * Proxy a remote CDN URL through this server.
 *
 * Forwards the Range header so the browser can seek. Pipes the remote
 * response directly to the client without buffering the whole video.
 */
function proxyRemoteVideo(
  cdnUrl: string,
  request: { headers: { range?: string } },
  reply: Parameters<Parameters<FastifyInstance['get']>[1]>[1],
): void {
  const url = new URL(cdnUrl);
  const isHttps = url.protocol === 'https:';
  const reqFn = isHttps ? httpsRequest : httpRequest;

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: '*/*',
  };

  // Forward the Range header for seeking support.
  if (request.headers.range) {
    headers['Range'] = request.headers.range;
  }

  const proxyReq = reqFn(
    {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers,
    },
    (proxyRes) => {
      // Forward status code (200 or 206 for range requests).
      const statusCode = proxyRes.statusCode ?? 200;

      // Forward relevant headers.
      const headersToForward = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ];
      for (const h of headersToForward) {
        const val = proxyRes.headers[h];
        if (val) reply.header(h, val);
      }

      // If no content-type was forwarded, default to video/mp4.
      if (!proxyRes.headers['content-type']) {
        reply.header('Content-Type', 'video/mp4');
      }

      reply.code(statusCode);
      reply.send(proxyRes);
    },
  );

  proxyReq.on('error', (err) => {
    console.error(`[stream] proxy error for ${cdnUrl}: ${err.message}`);
    const body: ErrorResponse = {
      error: true,
      code: 'PROXY_ERROR',
      message: `Failed to fetch video from CDN: ${err.message}`,
    };
    reply.code(502).send(body);
  });

  proxyReq.end();
}
