/**
 * Fastify server instance with CORS, logging, auth, and global error handler.
 * Issue #4: core API server setup.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { ErrorResponse } from '@nyxtok/shared';
import { authHook } from './middleware/auth';
import healthRoutes from './routes/health';
import feedRoutes from './routes/feed';
import likeRoutes from './routes/like';
import bookmarkRoutes from './routes/bookmark';
import dismissRoutes from './routes/dismiss';
import transcriptRoutes from './routes/transcript';
import searchRoutes from './routes/search';
import streamRoutes from './routes/stream';
import engagementRoutes from './routes/engagement';

/**
 * Build and configure the Fastify instance.
 *
 * Exported as a factory so tests can construct isolated app instances.
 */
export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'production'
          ? undefined
          : {
              target: 'pino-pretty',
              options: { colorize: true },
            },
    },
  });

  // --- CORS: allow all origins in dev ---
  await app.register(cors, {
    origin: true, // reflect all origins
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  // --- Auth middleware (preHandler) ---
  app.addHook('preHandler', authHook);

  // --- Global error handler ---
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const code =
      statusCode === 400
        ? 'VALIDATION_FAILED'
        : statusCode === 401
          ? 'UNAUTHORIZED'
          : statusCode === 404
            ? 'NOT_FOUND'
            : statusCode < 500
              ? 'BAD_REQUEST'
              : 'INTERNAL_ERROR';

    const body: ErrorResponse = {
      error: true,
      code,
      message: error.message || 'An unexpected error occurred.',
    };

    // Log 5xx errors with stack trace; 4xx are client errors.
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled server error');
    } else {
      request.log.warn({ err: error }, 'Client error');
    }

    reply.code(statusCode).send(body);
  });

  // --- 404 handler for unknown routes ---
  app.setNotFoundHandler((request, reply) => {
    const body: ErrorResponse = {
      error: true,
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found.`,
    };
    reply.code(404).send(body);
  });

  // --- Register route plugins ---
  await app.register(healthRoutes);
  await app.register(feedRoutes);
  await app.register(likeRoutes);
  await app.register(bookmarkRoutes);
  await app.register(dismissRoutes);
  await app.register(transcriptRoutes);
  await app.register(searchRoutes);
  await app.register(streamRoutes);
  await app.register(engagementRoutes);

  return app;
}

export default buildServer;
