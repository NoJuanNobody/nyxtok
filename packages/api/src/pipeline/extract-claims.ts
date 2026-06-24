/**
 * Issue #16: Claim extraction via LLM.
 *
 * Sends the transcript to Groq (llama-3.3-70b) with a prompt asking it to
 * extract all factual claims / technical statements / statistics / assertions
 * as a JSON array. Each claim is a single verifiable sentence.
 *
 * Retries 2x with a 30 s delay on failure; on total failure returns an empty
 * array so the transcript is still saved without validation.
 */

import type { Claim } from '@nyxtok/shared';
import { groqChat, type ChatMessage } from './groq-client';

/** Max claims to keep per video (overridable via MAX_CLAIMS_PER_VIDEO env). */
export const MAX_CLAIMS_PER_VIDEO = Number(
  process.env.MAX_CLAIMS_PER_VIDEO ?? 30,
);

const RETRY_DELAY_MS = 30 * 1000;
const MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** System prompt instructing the model to return a JSON array of claims. */
const SYSTEM_PROMPT = `You are a precise fact-checking assistant. Parse the transcript and extract all factual claims, technical statements, statistics, and assertions. Each claim should be a single verifiable sentence. Return ONLY a JSON array (no markdown fences, no prose) where each element is an object: {"text": "<claim sentence>", "context": "<surrounding transcript snippet>"}.`;

/**
 * Attempt a single LLM claim-extraction call and parse the response.
 * Throws on parse failure.
 */
async function extractClaimsOnce(transcript: string): Promise<Claim[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Transcript:\n\n${transcript}\n\nExtract the claims now. Return only the JSON array.`,
    },
  ];

  const raw = await groqChat(messages);
  const parsed = parseClaimsJson(raw);
  return parsed;
}

/**
 * Parse the LLM response into a `Claim[]`.
 *
 * Tolerates markdown fences and leading/trailing prose by extracting the first
 * `[...]` JSON fragment.
 */
function parseClaimsJson(raw: string): Claim[] {
  let text = raw.trim();

  // Strip markdown code fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  }

  // Find the first JSON array fragment.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in LLM response');
  }
  const jsonStr = text.slice(start, end + 1);

  const arr = JSON.parse(jsonStr) as Array<{
    text?: string;
    context?: string;
  }>;

  const claims: Claim[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
    claims.push({
      id: `claim-${i + 1}`,
      text: item.text.trim(),
      context: (item.context ?? '').trim(),
    });
  }
  return claims;
}

/**
 * Extract factual claims from a transcript.
 *
 * Retries up to `MAX_RETRIES` times with `RETRY_DELAY_MS` between attempts.
 * On total failure returns an empty array (the transcript is still saved).
 *
 * The result is capped at `MAX_CLAIMS_PER_VIDEO`.
 */
export async function extractClaims(transcript: string): Promise<Claim[]> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const claims = await extractClaimsOnce(transcript);
      const capped = claims.slice(0, MAX_CLAIMS_PER_VIDEO);
      console.log(
        `[extract-claims] extracted ${capped.length} claim(s)` +
          (claims.length > MAX_CLAIMS_PER_VIDEO
            ? ` (capped from ${claims.length})`
            : ''),
      );
      return capped;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[extract-claims] attempt ${attempt + 1} failed: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        console.log(`[extract-claims] retrying in ${RETRY_DELAY_MS / 1000}s`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.warn(
    `[extract-claims] all attempts failed; returning empty claims. ` +
      `Transcript saved without validation.`,
  );
  return [];
}
