// Database migration runner.
// Issue #2: reads and executes packages/shared/src/db/schema.sql against DATABASE_URL.
//
// Usage:
//   pnpm --filter @nyxtok/api migrate
//   # or directly:
//   npx tsx packages/api/src/migrate.ts

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { db } from '@nyxtok/shared';

/**
 * Resolve the schema.sql path. Supports both source-tree execution
 * (relative to this file inside the monorepo) and a fallback env override.
 *
 * `__dirname` is provided natively under CommonJS and shimmed by `tsx`
 * when running as ESM, so this works in both module modes.
 */
function resolveSchemaPath(): string {
  if (process.env.SCHEMA_SQL_PATH) {
    return process.env.SCHEMA_SQL_PATH;
  }
  // packages/api/src/migrate.ts -> packages/shared/src/db/schema.sql
  return join(dirname(__dirname), '..', 'shared', 'src', 'db', 'schema.sql');
}

async function migrate(): Promise<void> {
  const schemaPath = resolveSchemaPath();
  console.log(`[migrate] loading schema from: ${schemaPath}`);

  let sqlText: string;
  try {
    sqlText = await readFile(schemaPath, 'utf8');
  } catch (err) {
    console.error(`[migrate] failed to read schema file: ${schemaPath}`);
    throw err;
  }

  if (!sqlText.trim()) {
    throw new Error('[migrate] schema.sql is empty');
  }

  console.log('[migrate] executing schema against DATABASE_URL…');
  // postgres.js multi-statement execution: pass the raw SQL string.
  await db.unsafe(sqlText);

  console.log('[migrate] ✓ schema applied successfully.');
  await db.end({ timeout: 5 });
}

migrate().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exitCode = 1;
  // Ensure the process exits even if the connection lingers.
  db.end({ timeout: 5 }).finally(() => {
    process.exit(process.exitCode ?? 1);
  });
});
