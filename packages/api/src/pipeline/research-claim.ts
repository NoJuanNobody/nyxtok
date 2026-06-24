/**
 * Issue #17: Deep research per claim.
 *
 * For each claim: generate a search query, query DuckDuckGo, fetch the top
 * result URLs, extract text content, and truncate to ~1500 tokens. Results are
 * rate-limited to 3 concurrent claim researches and bounded by
 * VALIDATION_TIMEOUT (180 s) for the whole batch.
 *
 * On search failure for an individual claim, the claim is marked 'unverifiable'
 * and the rest continue. Returns the claim array with `source_url` and
 * `evidence` populated.
 */

import type { Claim } from '@nyxtok/shared';

/** Max concurrent claim researches. */
const MAX_CONCURRENT = 3;
/** Overall validation timeout (seconds), overridable via env. */
const VALIDATION_TIMEOUT_S = Number(process.env.VALIDATION_TIMEOUT ?? 180);
/** Max number of source URLs to fetch per claim. */
const MAX_SOURCES_PER_CLAIM = 5;
/** Truncate extracted text to this many characters (~1500 tokens). */
const MAX_EVIDENCE_CHARS = 6000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generate a concise web search query from a claim.
 * Takes the first ~12 words of the claim text.
 */
function buildSearchQuery(claimText: string): string {
  const words = claimText.split(/\s+/).slice(0, 12).join(' ');
  // Remove trailing punctuation.
  return words.replace(/[.,;:!?]+$/g, '').trim();
}

/**
 * Query DuckDuckGo's HTML endpoint and extract the top result URLs.
 * Returns up to `MAX_SOURCES_PER_CLAIM` URLs.
 */
async function duckDuckGoSearch(query: string): Promise<string[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`DuckDuckGo search failed (${res.status})`);
  }
  const html = await res.text();
  return extractResultUrls(html);
}

/**
 * Extract result URLs from DuckDuckGo HTML.
 *
 * DDG encodes the real URL in the `uddg=` query param of its redirect links.
 */
function extractResultUrls(html: string): string[] {
  const urls = new Set<string>();

  // Match uddg=<encoded-url>
  const uddgRe = /uddg=([^&"']+)/g;
  let m: RegExpExecArray | null;
  while ((m = uddgRe.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (decoded.startsWith('http')) {
        urls.add(decoded);
      }
    } catch {
      // ignore malformed
    }
  }

  // Fallback: match result__a href links directly.
  if (urls.size === 0) {
    const hrefRe = /class="result__a"[^>]*href="([^"]+)"/g;
    while ((m = hrefRe.exec(html)) !== null) {
      const href = m[1];
      if (href.startsWith('http')) {
        urls.add(href);
      }
    }
  }

  return [...urls].slice(0, MAX_SOURCES_PER_CLAIM);
}

/**
 * Fetch a URL and extract readable text content (simple HTML-to-text).
 * Truncates to MAX_EVIDENCE_CHARS.
 */
async function fetchUrlText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await res.text();
    return htmlToText(html).slice(0, MAX_EVIDENCE_CHARS);
  } catch {
    return null;
  }
}

/**
 * Naive HTML-to-text: strip scripts/styles/tags, decode entities, collapse
 * whitespace.
 */
function htmlToText(html: string): string {
  let text = html;
  // Remove script/style blocks.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // Convert block-level tags to newlines.
  text = text.replace(/<\/(p|div|br|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities.
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Collapse whitespace.
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

/**
 * Research a single claim: search + fetch + extract.
 * On failure returns the claim marked 'unverifiable' with no source.
 */
async function researchSingleClaim(claim: Claim): Promise<Claim> {
  const query = buildSearchQuery(claim.text);
  let urls: string[];
  try {
    urls = await duckDuckGoSearch(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[research-claim] search failed for "${claim.text.slice(0, 50)}...": ${msg}`);
    return { ...claim, status: 'unverifiable', source_url: undefined, evidence: undefined };
  }

  if (urls.length === 0) {
    return { ...claim, status: 'unverifiable', source_url: undefined, evidence: undefined };
  }

  // Fetch text from each URL; keep the first that yields content.
  for (const u of urls) {
    const content = await fetchUrlText(u);
    if (content && content.trim().length > 100) {
      return {
        ...claim,
        source_url: u,
        evidence: content,
      };
    }
  }

  // All fetches failed.
  return { ...claim, status: 'unverifiable', source_url: undefined, evidence: undefined };
}

/**
 * Run an async mapper over `items` with at most `concurrency` in-flight.
 */
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
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Research all claims concurrently (max 3 at a time) within the validation
 * timeout. Partial results are saved on timeout.
 *
 * Returns the claims with `source_url` and `evidence` populated where
 * research succeeded; unsuccessful claims are marked 'unverifiable'.
 */
export async function researchClaims(claims: Claim[]): Promise<Claim[]> {
  if (claims.length === 0) return claims;

  const timeoutMs = VALIDATION_TIMEOUT_S * 1000;

  // Race the batch against the overall timeout; on timeout return whatever
  // has completed.
  const completed: Claim[] = [];
  let timedOut = false;

  const batch = mapWithConcurrency(claims, MAX_CONCURRENT, async (claim) => {
    const result = await researchSingleClaim(claim);
    if (!timedOut) completed.push(result);
    return result;
  });

  const timer = new Promise<void>((resolve) =>
    setTimeout(() => {
      timedOut = true;
      console.warn(
        `[research-claim] validation timeout (${VALIDATION_TIMEOUT_S}s) reached; saving partial results`,
      );
      resolve();
    }, timeoutMs),
  );

  await Promise.race([batch, timer]);

  // If the batch finished before the timer, `completed` has all results.
  // If it timed out, we return partial results (those pushed before the flag).
  if (!timedOut) {
    return completed;
  }
  return completed;
}
