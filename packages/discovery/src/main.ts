/**
 * Discovery worker entry point.
 *
 * Issue #10: starts the cron scheduler that periodically runs the discovery
 * loop (search → viral filter → AI filter → DB upsert).
 */

import { startScheduler } from './scheduler';

// Allow running the discovery loop once immediately via `DISCOVERY_RUN_NOW=1`.
const RUN_NOW = process.env.DISCOVERY_RUN_NOW === '1';

function main(): void {
  if (RUN_NOW) {
    console.log('[main] DISCOVERY_RUN_NOW=1 — running discovery once then exiting');
    void (async () => {
      const { runDiscovery } = await import('./index');
      try {
        await runDiscovery();
        console.log('[main] one-shot discovery complete');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[main] one-shot discovery failed: ${msg}`);
        process.exitCode = 1;
      } finally {
        process.exit(0);
      }
    })();
    return;
  }

  const task = startScheduler();

  // Graceful shutdown.
  const shutdown = (sig: string) => {
    console.log(`[main] received ${sig}, stopping scheduler...`);
    task.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
