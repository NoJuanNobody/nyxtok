/**
 * In-memory job queue — thin shim over the pipeline orchestrator (Issue #23).
 *
 * The like/bookmark routes call `enqueueTranscriptJob` from this module; it now
 * delegates to `packages/api/src/pipeline/orchestrator.ts` which runs the full
 * transcribe -> validate -> vault pipeline with a concurrency cap of 3.
 */

export {
  enqueueTranscriptJob,
  getQueuedJobs,
  isQueued,
  runningCount,
} from './pipeline/orchestrator';
