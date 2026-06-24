/**
 * AI relevance filter.
 *
 * Issue #9: combines a fast keyword whitelist score with a slower embedding
 * similarity score (Xenova/transformers all-MiniLM-L6-v2) when the keyword
 * score is too low to make a confident decision.
 *
 * Scoring rules:
 *   1. keyword_score: each whitelist keyword found in caption/hashtags adds
 *      +0.1, capped at 1.0.
 *   2. If keyword_score >= 0.5 we trust it.
 *   3. Otherwise we compute a cosine-similarity embedding score between the
 *      caption+hashtags text and a reference AI-topic embedding.
 *   4. final_score = max(keyword_score, (keyword_score + embedding_score) / 2)
 *   5. A video passes when final_score >= 0.3.
 */

import type { TikTokVideoMeta } from './tiktok-client';

/** Whitelist of AI-relevant keywords / hashtags (without leading #). */
export const AI_KEYWORD_WHITELIST: string[] = [
  'AI',
  'MachineLearning',
  'LLM',
  'GenAI',
  'AItutorial',
  'ChatGPT',
  'Midjourney',
  'DeepLearning',
  'NeuralNetworks',
  'ComputerVision',
  'NLP',
  'TransformerModels',
  'PromptEngineering',
];

/** Reference sentence used to pre-compute the AI-topic embedding. */
export const AI_REFERENCE_SENTENCE =
  'artificial intelligence machine learning deep learning neural networks LLM';

/** Minimum score required to pass the AI filter. */
export const AI_MIN_SCORE = 0.3;

export interface AiFilterResult {
  /** 0.0–1.0 final relevance score. */
  score: number;
  /** True when the video should be kept. */
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Embedding model (lazy singleton — only loaded when needed).
// ---------------------------------------------------------------------------

type Pipeline = (
  text: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: number[] | number[][]; tolist?: () => number[][] }>;

let pipelinePromise: Promise<Pipeline> | null = null;
let referenceEmbeddingPromise: Promise<Float32Array> | null = null;

async function getPipeline(): Promise<Pipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      // Allow remote model download on first run.
      env.allowLocalModels = false;
      return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as Pipeline;
    })();
  }
  return pipelinePromise;
}

async function getReferenceEmbedding(): Promise<Float32Array> {
  if (!referenceEmbeddingPromise) {
    referenceEmbeddingPromise = (async () => {
      const pipe = await getPipeline();
      const out = await pipe(AI_REFERENCE_SENTENCE, {
        pooling: 'mean',
        normalize: true,
      });
      return toFloat32(out);
    })();
  }
  return referenceEmbeddingPromise;
}

/** Coerce a transformers.js output object into a Float32Array vector. */
function toFloat32(out: unknown): Float32Array {
  if (out && typeof out === 'object') {
    const o = out as { data?: number[] | Float32Array; tolist?: () => number[][] };
    if (o.tolist) {
      const list = o.tolist();
      if (list.length > 0) return Float32Array.from(list[0]);
    }
    if (o.data) return Float32Array.from(o.data);
  }
  throw new Error('ai-filter: unexpected embedding output shape');
}

/** Cosine similarity between two normalized vectors. */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// Keyword score
// ---------------------------------------------------------------------------

/** Build the haystack: caption + space-joined hashtags, lowercased. */
function buildHaystack(v: TikTokVideoMeta): string {
  const parts = [v.caption, v.hashtags.join(' ')];
  return parts.join(' ').toLowerCase();
}

/** Keyword match score: +0.1 per matched whitelist keyword, capped at 1.0. */
export function keywordScore(v: TikTokVideoMeta): number {
  const haystack = buildHaystack(v);
  let score = 0;
  for (const kw of AI_KEYWORD_WHITELIST) {
    if (haystack.includes(kw.toLowerCase())) {
      score += 0.1;
    }
  }
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Score a TikTok video for AI relevance.
 *
 * Uses keyword matching first; falls back to embedding similarity when the
 * keyword score is below 0.5. Final score is the max of the keyword score and
 * the average of (keyword, embedding) scores.
 */
export async function scoreVideo(v: TikTokVideoMeta): Promise<AiFilterResult> {
  const kScore = keywordScore(v);

  let finalScore: number;

  if (kScore >= 0.5) {
    finalScore = kScore;
  } else {
    // Compute embedding similarity as a fallback / refinement.
    let embeddingScore = 0;
    try {
      const pipe = await getPipeline();
      const ref = await getReferenceEmbedding();
      const text = buildHaystack(v) || v.caption || AI_REFERENCE_SENTENCE;
      const out = await pipe(text, { pooling: 'mean', normalize: true });
      const emb = toFloat32(out);
      embeddingScore = cosineSimilarity(emb, ref);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ai-filter] embedding fallback failed: ${msg}`);
      // Fall back to keyword-only score.
      embeddingScore = 0;
    }
    finalScore = Math.max(kScore, (kScore + embeddingScore) / 2);
  }

  return { score: finalScore, passed: finalScore >= AI_MIN_SCORE };
}

/** Filter a list of videos, keeping only those that pass. */
export async function applyAiFilter(
  videos: TikTokVideoMeta[],
): Promise<Array<TikTokVideoMeta & { ai_score: number }>> {
  const results: Array<TikTokVideoMeta & { ai_score: number }> = [];
  for (const v of videos) {
    const r = await scoreVideo(v);
    if (r.passed) {
      results.push({ ...v, ai_score: r.score });
    }
  }
  return results;
}
