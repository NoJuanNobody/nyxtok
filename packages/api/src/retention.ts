/**
 * Retention sweeper.
 *
 * Discovered videos are stored for a limited window (default 48h) and then
 * purged — UNLESS the user has engaged with them (like / bookmark / watch
 * later), in which case they are kept indefinitely. See `deleteExpiredVideos`
 * for the exact rule.
 *
 * Runs once at startup and then on a fixed interval. Each purge also removes the
 * cached mp4 that the stream endpoint downloaded on demand. Vault notes are only
 * written for engaged videos (which are retained), so there's nothing to clean
 * up there.
 */
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { deleteExpiredVideos } from '@nyxtok/shared';

/** Must match VIDEO_DATA_DIR used by the stream resolver. */
const DATA_DIR = process.env.VIDEO_DATA_DIR ?? '/data/videos';

/** Hours a video is kept without engagement before it is purged. */
const RETENTION_HOURS = process.env.RETENTION_HOURS
  ? parseInt(process.env.RETENTION_HOURS, 10)
  : 48;

/** How often the sweeper runs. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Delete expired, unengaged videos and their cached files. */
export async function sweepExpiredVideos(): Promise<void> {
  try {
    const deleted = await deleteExpiredVideos(RETENTION_HOURS);
    if (deleted.length === 0) return;

    console.log(
      `[retention] purged ${deleted.length} unengaged video(s) older than ${RETENTION_HOURS}h`,
    );

    await Promise.all(
      deleted.map((id) =>
        unlink(join(DATA_DIR, `${id}.mp4`)).catch(() => {
          /* file may never have been downloaded — ignore */
        }),
      ),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[retention] sweep failed: ${msg}`);
  }
}

/** Start the periodic retention sweep (runs immediately, then hourly). */
export function startRetentionSweeper(): void {
  void sweepExpiredVideos();
  const timer = setInterval(() => void sweepExpiredVideos(), SWEEP_INTERVAL_MS);
  // Don't keep the process alive solely for the sweep timer.
  timer.unref?.();
}
