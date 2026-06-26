// @nyxtok/shared — shared DB client, query helpers, domain types, and config.

export { db, postgres, default } from './db/client';
export {
  upsertVideo,
  getFeed,
  searchVideos,
  updateVideoStatus,
  getVideo,
  failOrphanedInProgressJobs,
  deleteExpiredVideos,
} from './db/queries';

// All shared domain types (Video, status unions, API envelopes, etc.)
export * from './types/index';

// Config loader + EnvConfig type
export { loadConfig } from './config';
export type { EnvConfig } from './types/config';
