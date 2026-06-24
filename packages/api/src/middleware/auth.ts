/**
 * Bearer token authentication middleware.
 *
 * Compares the Authorization header against the AUTH_TOKEN env var.
 * Skips auth for GET /health (the liveness probe).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorResponse } from '@nyxtok/shared';

/**
 * Fastify preHandler hook that validates Bearer tokens.
 *
 * - Skips auth for `GET /health`.
 * - If AUTH_TOKEN is not set in the environment, auth is disabled (dev mode).
 * - Returns 401 ErrorResponse on missing/invalid token.
 */
export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip auth for the health check endpoint.
  if (request.method === 'GET' && request.url === '/health') {
    return;
  }

  const authToken = process.env.AUTH_TOKEN;

  // If no AUTH_TOKEN is configured, allow all requests (dev mode).
  if (!authToken) {
    return;
  }

  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    const body: ErrorResponse = {
      error: true,
      code: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    };
    reply.code(401).send(body);
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (token !== authToken) {
    const body: ErrorResponse = {
      error: true,
      code: 'UNAUTHORIZED',
      message: 'Invalid authentication token.',
    };
    reply.code(401).send(body);
    return;
  }
}
