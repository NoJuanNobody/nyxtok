/**
 * Issue #18: LLM classification per claim.
 *
 * For each claim + its source content, asks Groq (llama-3.3-70b) to classify
 * the claim as verified / partially-verified / contradicted / unverifiable,
 * returning the source URL, a relevant quote, and notes.
 *
 * Claims with no evidence (already 'unverifiable') are passed through.
 */

import type { Claim, ClaimStatus } from '@nyxtok/shared';
import { groqChat, type ChatMessage } from './groq-client';

const MAX_CONCURRENT = 3;

const SYSTEM_PROMPT = `You are a rigorous fact-checker. Compare the given claim against the provided source content. Classify the claim as exactly one of: "verified", "partially-verified", "contradicted", or "unverifiable". Return ONLY a JSON object (no markdown fences, no prose) with this shape: {"status": "<one of the four values>", "evidence": "<a relevant quote or paraphrase from the source>", "notes": "<brief explanation>"}.`;

interface ClassifyResult {
  status: ClaimStatus;
  source_url?: string;
  evidence?: string;
  notes?: string;
}

/** Classify a single claim against its evidence. */
async function classifySingleClaim(claim: Claim): Promise<Claim> {
  // Pass through unverifiable claims that have no source.
  if (!claim.source_url || !claim.evidence) {
    return {
      ...claim,
      status: claim.status ?? 'unverifiable',
    };
  }

  const userContent = `Claim: "${claim.text}"\n\nSource URL: ${claim.source_url}\n\nSource content:\n${claim.evidence}\n\nClassify this claim against the source content.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  try {
    const raw = await groqChat(messages);
    const result = parseClassifyResponse(raw);
    return {
      ...claim,
      status: result.status,
      source_url: result.source_url ?? claim.source_url,
      evidence: result.evidence ?? claim.evidence,
      notes: result.notes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[classify-claim] failed for "${claim.text.slice(0, 50)}...": ${msg}`,
    );
    return { ...claim, status: 'unverifiable', notes: `Classification error: ${msg}` };
  }
}

/** Parse the LLM classification response. */
function parseClassifyResponse(raw: string): ClassifyResult {
  let text = raw.trim();

  // Strip markdown fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  }

  // Extract the JSON object fragment.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in classification response');
  }
  const jsonStr = text.slice(start, end + 1);

  const obj = JSON.parse(jsonStr) as {
    status?: string;
    source_url?: string;
    evidence?: string;
    notes?: string;
  };

  const validStatuses: ClaimStatus[] = [
    'verified',
    'partially-verified',
    'contradicted',
    'unverifiable',
  ];
  const status = validStatuses.includes(obj.status as ClaimStatus)
    ? (obj.status as ClaimStatus)
    : 'unverifiable';

  return {
    status,
    source_url: obj.source_url,
    evidence: obj.evidence,
    notes: obj.notes,
  };
}

/** Run an async mapper with bounded concurrency. */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Classify all claims against their gathered evidence.
 *
 * Runs up to `MAX_CONCURRENT` LLM calls in parallel. Claims with no evidence
 * are passed through as 'unverifiable'.
 */
export async function classifyClaims(claims: Claim[]): Promise<Claim[]> {
  if (claims.length === 0) return claims;
  return mapWithConcurrency(claims, MAX_CONCURRENT, classifySingleClaim);
}
