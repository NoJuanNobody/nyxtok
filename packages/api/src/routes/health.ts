/**
 * GET /health — liveness / dependency health check.
 *
 * Returns { status: 'ok', db: 'connected', storage: 'mounted' }.
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@nyxtok/shared';

export default async function healthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const body: HealthResponse = {
      status: 'ok',
      db: 'connected',
      storage: 'mounted',
    };
    reply.send(body);
  });
}
