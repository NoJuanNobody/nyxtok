/**
 * API server entry point.
 * Issue #4: starts the Fastify server on PORT env var (default 3000).
 */
import { buildServer } from './server';

async function start(): Promise<void> {
  const app = await buildServer();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
