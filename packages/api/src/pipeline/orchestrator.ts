/**
 * Issue #23: Pipeline orchestrator.
 *
 * Simple in-memory job queue that runs the full transcript -> validation ->
 * vault pipeline when a user likes or bookmarks a video. Concurrent jobs are
 * capped at 3; each step updates the DB so partial results survive failures.
 *
 * Public API: `enqueueTranscriptJob(video_id)` — called by like/bookmark routes.
 */

import type { TranscriptResult, ValidationReport, Video } from '@nyxtok/shared';
import {
  failOrphanedInProgressJobs,
  getVideo,
  updateVideoStatus,
} from '@nyxtok/shared';
import { transcribe } from './transcribe';
import { extractClaims } from './extract-claims';
import { researchClaims } from './research-claim';
import { classifyClaims } from './classify-claim';
import { validationSummary } from './validation-summary';
import { writeVault } from './vault-writer';

/** Max number of pipeline jobs running concurrently. */
const MAX_CONCURRENT_JOBS = 3;

/** Whether the validation pass is enabled (env: VALIDATION_ENABLED). */
function validationEnabled(): boolean {
  return (process.env.VALIDATION_ENABLED ?? 'true').toLowerCase() !== 'false';
}

// ---------------------------------------------------------------------------
// In-memory queue
// ---------------------------------------------------------------------------

/** Set of video_ids waiting to be processed (avoids duplicate enqueue). */
const pendingQueue = new Set<string>();
/** Set of video_ids currently being processed. */
const running = new Set<string>();
/** Resolvers waiting for a slot to free up. */
const waiters: Array<() => void> = [];

let schedulerStarted = false;

/** Wait until a concurrency slot is available. */
async function acquireSlot(video_id: string): Promise<void> {
  if (running.size < MAX_CONCURRENT_JOBS) {
    running.add(video_id);
    return;
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve);
  });
  running.add(video_id);
}

/** Release a concurrency slot and wake the next waiter. */
function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    next();
  }
}

/**
 * Run the full pipeline for a single video.
 *
 * Steps: transcribe -> extractClaims -> researchClaims -> classifyClaims ->
 * validationSummary -> writeVault. The DB is updated at each step; on failure
 * the error is logged and statuses are marked failed with partial results
 * preserved.
 */
async function runPipeline(video_id: string): Promise<void> {
  let video: Video | null = null;
  try {
    video = await getVideo(video_id);
    if (!video) {
      console.warn(`[orchestrator] ${video_id}: video not found, skipping`);
      return;
    }

    // Skip if transcript already completed.
    if (video.transcript_status === 'completed') {
      console.log(`[orchestrator] ${video_id}: transcript already completed, skipping`);
      return;
    }

    // Set validation_status = in_progress alongside transcript.
    await updateVideoStatus(video_id, {
      transcript_status: 'in_progress',
      validation_status: validationEnabled() ? 'in_progress' : 'skipped',
    });

    // Step 1: transcribe.
    const transcript: TranscriptResult = await transcribe(video);

    // Reload video to get fresh status fields.
    video = (await getVideo(video_id)) ?? video;

    // Steps 2-5: claim extraction + deep research validation.
    let report: ValidationReport | null = null;
    if (validationEnabled()) {
      // Step 2: extract claims.
      const claims = await extractClaims(transcript.text);
      console.log(`[orchestrator] ${video_id}: extracted ${claims.length} claims`);

      if (claims.length > 0) {
        // Step 3: deep research per claim.
        const researched = await researchClaims(claims);
        console.log(
          `[orchestrator] ${video_id}: researched ${researched.length} claims`,
        );

        // Step 4: classify each claim.
        const classified = await classifyClaims(researched);
        console.log(
          `[orchestrator] ${video_id}: classified ${classified.length} claims`,
        );

        // Step 5: validation summary + DB update.
        report = await validationSummary(video_id, classified);
        console.log(
          `[orchestrator] ${video_id}: validation summary (${report.accuracy_score}%)`,
        );

        // Reload video so vault writer has the latest validation columns.
        video = (await getVideo(video_id)) ?? video;
      } else {
        // No claims — mark validation as skipped.
        await updateVideoStatus(video_id, { validation_status: 'skipped' });
        video = (await getVideo(video_id)) ?? video;
      }
    }

    // Step 6: write vault note.
    await writeVault(video, transcript, report);

    console.log(`[orchestrator] ${video_id}: pipeline completed ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] ${video_id}: pipeline failed: ${msg}`);

    // Mark statuses as failed, preserving partial results.
    try {
      const fresh = await getVideo(video_id);
      const updates: Record<string, unknown> = {};
      if (fresh) {
        if (fresh.transcript_status !== 'completed') {
          updates.transcript_status = 'failed';
          updates.transcript_error = msg.slice(0, 1000);
        }
        if (
          validationEnabled() &&
          fresh.validation_status !== 'completed' &&
          fresh.validation_status !== 'skipped'
        ) {
          updates.validation_status = 'failed';
        }
      }
      if (Object.keys(updates).length > 0) {
        await updateVideoStatus(video_id, updates);
      }
    } catch (dbErr) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error(`[orchestrator] ${video_id}: failed to mark DB failed: ${dbMsg}`);
    }
  }
}

/**
 * Background scheduler loop: drains the pending queue, respecting the
 * concurrency limit. Started lazily on first enqueue.
 */
function startScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Run an async loop that keeps workers pulling from the queue.
  (async () => {
    while (true) {
      // Get the next pending video_id.
      let nextId: string | null = null;
      for (const id of pendingQueue) {
        pendingQueue.delete(id);
        nextId = id;
        break;
      }

      if (!nextId) {
        // Nothing to do; wait a bit before re-checking.
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      // Acquire a concurrency slot, then run.
      // We don't await runPipeline here directly; instead launch it and let
      // acquireSlot/releaseSlot gate concurrency.
      const id = nextId;
      acquireSlot(id).then(() => {
        runPipeline(id).finally(() => {
          running.delete(id);
          releaseSlot();
        });
      });
    }
  })().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] scheduler crashed: ${msg}`);
    schedulerStarted = false;
  });
}

/**
 * Reconcile orphaned jobs left `in_progress` by a previous process.
 *
 * The queue lives in memory, so a restart while a pipeline was running strands
 * the DB row at `in_progress` with no worker to finish it — the UI then spins
 * "Transcribing…" / "Validating…" forever. Run this once at startup, before any
 * new job can be enqueued: nothing is processing, so every `in_progress` row is
 * orphaned and is marked `failed`.
 */
export async function recoverOrphanedJobs(): Promise<void> {
  try {
    const recovered = await failOrphanedInProgressJobs();
    if (recovered.length > 0) {
      console.warn(
        `[orchestrator] recovered ${recovered.length} orphaned in_progress job(s) ` +
          `left by a previous run: ${recovered.join(', ')}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] failed to recover orphaned jobs: ${msg}`);
  }
}

/**
 * Enqueue a video for the full transcript + validation + vault pipeline.
 *
 * No-op if the video is already pending or running. Called by the
 * like/bookmark routes.
 */
export function enqueueTranscriptJob(video_id: string): void {
  if (pendingQueue.has(video_id) || running.has(video_id)) {
    return;
  }
  pendingQueue.add(video_id);
  startScheduler();
}

// ---------------------------------------------------------------------------
// Diagnostics (re-exported for the legacy queue.ts shim)
// ---------------------------------------------------------------------------

/** All video_ids currently pending or running. */
export function getQueuedJobs(): string[] {
  return [...pendingQueue, ...running];
}

/** Whether a video_id is pending or actively processing. */
export function isQueued(video_id: string): boolean {
  return pendingQueue.has(video_id) || running.has(video_id);
}

/** Number of jobs currently running. */
export function runningCount(): number {
  return running.size;
}
