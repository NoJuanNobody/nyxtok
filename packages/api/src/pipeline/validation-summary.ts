/**
 * Issue #18: Validation summary.
 *
 * Synthesizes all claim validation results into a human-readable summary via
 * Groq (llama-3.3-70b), computes an accuracy score, and returns a
 * `ValidationReport`. Also persists the validation metrics to the DB.
 */

import type { Claim, ValidationReport } from '@nyxtok/shared';
import { updateVideoStatus } from '@nyxtok/shared';
import { groqChat, type ChatMessage } from './groq-client';

const SYSTEM_PROMPT = `You are a fact-checking analyst. Synthesize the provided claim validation results into a concise summary. Include: an overall assessment, notable contradictions, and any corrections or gaps. Be factual and specific. Return plain text prose (no JSON).`;

/**
 * Compute the accuracy score: verified_count / total_claims * 100.
 * Claims that are unverifiable are excluded from the denominator when no claims
 * were verifiable at all (score 0).
 */
function computeAccuracyScore(claims: Claim[]): number {
  if (claims.length === 0) return 0;
  const verified = claims.filter((c) => c.status === 'verified').length;
  return Math.round((verified / claims.length) * 100);
}

/** Deduplicate source URLs across all claims. */
function collectSources(claims: Claim[]): string[] {
  const set = new Set<string>();
  for (const c of claims) {
    if (c.source_url) set.add(c.source_url);
  }
  return [...set];
}

/** Collect corrections for contradicted claims. */
function collectCorrections(claims: Claim[]): string[] {
  const corrections: string[] = [];
  for (const c of claims) {
    if (c.status === 'contradicted') {
      corrections.push(
        `${c.text}${c.notes ? ` — ${c.notes}` : ''}`,
      );
    }
  }
  return corrections;
}

/** Build the user-facing summary of claim results for the LLM prompt. */
function buildClaimsDigest(claims: Claim[]): string {
  return claims
    .map((c, i) => {
      const evidence = c.evidence ? ` Evidence: "${c.evidence.slice(0, 200)}"` : '';
      const notes = c.notes ? ` Notes: ${c.notes}` : '';
      return `${i + 1}. [${c.status ?? 'unverifiable'}] "${c.text}" (source: ${c.source_url ?? 'none'})${evidence}${notes}`;
    })
    .join('\n');
}

/**
 * Generate a ValidationReport for the given (already classified) claims and
 * persist the validation metrics to the DB.
 *
 * @param video_id  The video these claims belong to.
 * @param claims    Classified claims (each has status/source/evidence/notes).
 */
export async function validationSummary(
  video_id: string,
  claims: Claim[],
): Promise<ValidationReport> {
  const accuracy_score = computeAccuracyScore(claims);
  const sources = collectSources(claims);
  const corrections = collectCorrections(claims);

  let summary: string;
  if (claims.length === 0) {
    summary =
      'No verifiable claims were extracted from this transcript; validation was skipped.';
  } else {
    try {
      const digest = buildClaimsDigest(claims);
      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Claim validation results (accuracy ${accuracy_score}%):\n\n${digest}\n\nWrite the summary now.`,
        },
      ];
      summary = await groqChat(messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[validation-summary] LLM summary failed: ${msg}`);
      summary = `Validation completed with ${claims.length} claim(s). Accuracy score: ${accuracy_score}%. (LLM summary unavailable.)`;
    }
  }

  // Persist validation metrics to the DB.
  await updateVideoStatus(video_id, {
    validation_status: 'completed',
    validation_accuracy_score: accuracy_score,
    validation_claims_count: claims.length,
    validation_sources_count: sources.length,
  });

  return {
    accuracy_score,
    claims,
    summary,
    sources,
    corrections,
  };
}
