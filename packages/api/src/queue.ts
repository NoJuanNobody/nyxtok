/**
 * Simple in-memory job queue.
 *
 * Stores video_ids that need transcript processing. The orchestrator (wave 4)
 * will replace this with a durable queue.
 */

/** Internal set-backed queue that avoids duplicate enqueue. */
const queue = new Set<string>();

/**
 * Enqueue a video_id for transcript processing.
 * No-op if already queued.
 */
export function enqueueTranscriptJob(video_id: string): void {
  queue.add(video_id);
}

/**
 * Dequeue the next video_id to process, or null if the queue is empty.
 */
export function dequeueTranscriptJob(): string | null {
  for (const id of queue) {
    queue.delete(id);
    return id;
  }
  return null;
}

/**
 * Peek at the queue without removing items (for diagnostics/testing).
 */
export function getQueuedJobs(): string[] {
  return [...queue];
}

/**
 * Check whether a video_id is currently queued.
 */
export function isQueued(video_id: string): boolean {
  return queue.has(video_id);
}
