/**
 * Cron scheduler for the discovery worker.
 *
 * Issue #10: runs the discovery loop on a configurable cron schedule.
 * Failures are logged and skipped — the next scheduled run resumes normally.
 */

import cron from 'node-cron';
import { runDiscovery } from './index';

/** Cron expression, overridable via DISCOVERY_CRON env var. */
const CRON_SCHEDULE = process.env.DISCOVERY_CRON ?? '0 */6 * * *';

let running = false;

async function tick(): Promise<void> {
  if (running) {
    console.warn('[scheduler] previous run still in progress — skipping tick');
    return;
  }
  running = true;
  const startedAt = new Date().toISOString();
  console.log(`[scheduler] discovery run starting at ${startedAt}`);
  try {
    await runDiscovery();
    const endedAt = new Date().toISOString();
    console.log(`[scheduler] discovery run completed at ${endedAt}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[scheduler] discovery run failed at ${new Date().toISOString()}: ${msg}`);
    if (stack) console.error(stack);
    // Do not rethrow — skip this run and resume next scheduled tick.
  } finally {
    running = false;
  }
}

/** Start the cron scheduler. Returns the node-cron ScheduledTask. */
export function startScheduler(): cron.ScheduledTask {
  if (!cron.validate(CRON_SCHEDULE)) {
    throw new Error(`[scheduler] invalid cron expression: ${CRON_SCHEDULE}`);
  }
  console.log(`[scheduler] starting with schedule "${CRON_SCHEDULE}"`);
  const task = cron.schedule(CRON_SCHEDULE, () => {
    void tick();
  });
  return task;
}
