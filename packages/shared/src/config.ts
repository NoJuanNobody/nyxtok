import type { EnvConfig } from './types/config';

/** Environment variables that must be present at startup. */
const REQUIRED_VARS: ReadonlyArray<keyof EnvConfig> = [
  'DATABASE_URL',
  'VAULT_PATH',
  'AUTH_TOKEN',
];

/**
 * Load and validate environment variables into a typed `EnvConfig`.
 *
 * Reads from `process.env` by default. Throws an `Error` listing every missing
 * required variable so misconfiguration surfaces immediately at boot.
 *
 * @param env - Override source (defaults to `process.env`); useful for tests.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): EnvConfig {
  const missing = REQUIRED_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }

  return {
    DATABASE_URL: env.DATABASE_URL as string,
    VAULT_PATH: env.VAULT_PATH as string,
    AUTH_TOKEN: env.AUTH_TOKEN as string,
    GROQ_API_KEY: env.GROQ_API_KEY,
    DISCOVERY_CRON: env.DISCOVERY_CRON,
    VALIDATION_ENABLED: env.VALIDATION_ENABLED,
    VALIDATION_MODEL: env.VALIDATION_MODEL,
    MAX_CLAIMS_PER_VIDEO: env.MAX_CLAIMS_PER_VIDEO,
    VALIDATION_TIMEOUT: env.VALIDATION_TIMEOUT,
    WHISPER_SERVICE: env.WHISPER_SERVICE,
    PORT: env.PORT,
  };
}
