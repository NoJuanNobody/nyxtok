/**
 * Strongly-typed shape of all environment variables consumed by the monorepo.
 *
 * Required vars have non-optional fields; optional vars are nullable. See
 * `.env.example` at the repo root for descriptions.
 */
export interface EnvConfig {
  // --- Required ---
  /** Postgres connection string for the metadata DB. */
  DATABASE_URL: string;
  /** Absolute path to the on-disk vault where media/transcripts are stored. */
  VAULT_PATH: string;
  /** Bearer token used to authenticate API requests. */
  AUTH_TOKEN: string;

  // --- Optional with defaults ---
  /** Groq API key (required when WHISPER_SERVICE=groq or VALIDATION_ENABLED). */
  GROQ_API_KEY?: string;
  /** Cron expression controlling the discovery schedule. */
  DISCOVERY_CRON?: string;
  /** Whether the LLM validation pass runs on new transcripts. */
  VALIDATION_ENABLED?: string;
  /** Groq model id used for validation, e.g. `llama-3.3-70b`. */
  VALIDATION_MODEL?: string;
  /** Max claims extracted per video before validation. */
  MAX_CLAIMS_PER_VIDEO?: string;
  /** Per-video validation timeout in seconds. */
  VALIDATION_TIMEOUT?: string;
  /** Which whisper backend to use (`groq` | ...). */
  WHISPER_SERVICE?: string;
  /** Port the API server listens on. */
  PORT?: string;
}
