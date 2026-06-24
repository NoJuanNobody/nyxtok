/** Verdict for a single extracted claim after fact-checking. */
export type ClaimStatus =
  | 'verified'
  | 'partially-verified'
  | 'contradicted'
  | 'unverifiable';

/** A single factual claim extracted from a video transcript. */
export interface Claim {
  id: string;
  /** The assertion, stated as a standalone claim. */
  text: string;
  /** Surrounding transcript text the claim was pulled from. */
  context: string;
  status?: ClaimStatus;
  /** URL of the source used to verify / refute the claim. */
  source_url?: string;
  /** Quoted evidence from the source supporting the verdict. */
  evidence?: string;
  /** Freeform analyst / LLM notes. */
  notes?: string;
}

/** Structured output of the LLM validation pass for one video. */
export interface ValidationReport {
  /** 0-100 accuracy score across all claims. */
  accuracy_score: number;
  /** All claims extracted from the transcript. */
  claims: Claim[];
  /** Short human-readable summary of the validation pass. */
  summary: string;
  /** Deduplicated list of source URLs consulted. */
  sources: string[];
  /** List of corrections to claims that were contradicted. */
  corrections: string[];
}
