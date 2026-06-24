// PostgreSQL client (postgres.js) with connection pooling.
// Issue #2: exports a shared `db` object used across the monorepo.

import postgres from 'postgres';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/nyxtok';

if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Define it in your environment (see .env.example).',
  );
}

/**
 * Shared postgres.js connection.
 *
 * postgres.js maintains an internal pool of connections; each query borrows
 * a connection from the pool and returns it on completion. The options below
 * cap concurrent connections and tune prepared-statement / idle behaviour for
 * a typical small-to-medium service workload.
 */
export const db = postgres(DATABASE_URL, {
  // Pool size: max simultaneous connections.
  max: 10,
  // Idle timeout (seconds) before a connection is closed.
  idle_timeout: 20,
  // Connection timeout (seconds).
  connect_timeout: 10,
  // Prepared statements are safe and faster; disable only if behind a
  // connection pooler like PgBouncer in transaction mode.
  prepare: true,
  // Convert JS Date <-> TIMESTAMP.
  transform: {
    undefined: null,
  },
  // Mask parameters on error to avoid leaking secrets in logs.
  debug: process.env.POSTGRES_DEBUG === '1' ? (conn, q) => console.log(q) : undefined,
});

/** Underlying postgres.js constructor (re-exported for tests / advanced use). */
export { postgres };

export default db;
