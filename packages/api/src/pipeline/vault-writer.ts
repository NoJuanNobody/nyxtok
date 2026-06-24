/**
 * Issue #19: Vault writer.
 *
 * Generates a Markdown note at `{VAULT_PATH}/{video_id}.md` with YAML
 * frontmatter (all DB fields) and structured sections: Key Points, Transcript,
 * Deep Research Validation (Summary, Claim-by-Claim, Sources, Corrections &
 * Gaps), Notes. Auto-assigns tags from hashtags matched against a taxonomy.
 *
 * Updates `transcript_path` in the DB to the generated file path.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Claim, TranscriptResult, ValidationReport, Video } from '@nyxtok/shared';
import { updateVideoStatus } from '@nyxtok/shared';

/**
 * Lightweight AI/tech taxonomy used for auto-tagging.
 * A hashtag matching any of these (case-insensitive) is promoted to a vault tag.
 */
const TAXONOMY = new Set([
  'ai',
  'machinelearning',
  'ml',
  'deeplearning',
  'llm',
  'gpt',
  'chatgpt',
  'transformer',
  'neuralnetwork',
  'datascience',
  'python',
  'pytorch',
  'tensorflow',
  'nlp',
  'cv',
  'computervision',
  'robotics',
  'agi',
  'openai',
  'anthropic',
  'finetuning',
  'rag',
  'agents',
  'promptengineering',
  'diffusion',
  'stable',
  'sd',
  'midjourney',
  'coding',
  'programming',
  'tech',
  'startup',
  'saas',
]);

/** Parse the semicolon-separated hashtags column into a list. */
function parseHashtags(video: Video): string[] {
  const raw = video.hashtags ?? '';
  return raw
    .split(';')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t.length > 0);
}

/** Parse the semicolon-separated user tags column into a list. */
function parseUserTags(video: Video): string[] {
  const raw = video.tags ?? '';
  return raw
    .split(';')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Auto-assign tags: extract hashtags, match against the taxonomy, and merge
 * with any existing user tags.
 */
function assignTags(video: Video): string[] {
  const hashtags = parseHashtags(video);
  const matched = hashtags.filter((h) => TAXONOMY.has(h.toLowerCase()));
  const userTags = parseUserTags(video);
  return [...new Set([...matched, ...userTags])];
}

/** Escape a value for YAML frontmatter. */
function yamlValue(val: unknown): string {
  if (val === null || val === undefined) return '""';
  if (val instanceof Date) return `"${val.toISOString()}"`;
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  const s = String(val);
  // Quote if it contains special chars.
  if (/[:#\-?{}[\]&*!|>'"%@`,]/.test(s) || s === '' || s !== s.trim()) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Build the YAML frontmatter block. */
function buildFrontmatter(
  video: Video,
  tags: string[],
  transcriptSource: string,
): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${yamlValue(video.caption ?? video.video_id)}`);
  lines.push(`creator: ${yamlValue(video.creator_handle)}`);
  lines.push(`creator_id: ${yamlValue(video.creator_id)}`);
  lines.push(`tiktok_url: ${yamlValue(`https://www.tiktok.com/@${video.creator_handle}/video/${video.video_id}`)}`);
  lines.push(`discovered_date: ${yamlValue(video.discovered_at)}`);
  lines.push(`published_date: ${yamlValue(video.published_at)}`);
  lines.push(`duration_seconds: ${yamlValue(video.duration_seconds)}`);
  lines.push(`view_count: ${yamlValue(video.view_count)}`);
  lines.push(`like_count: ${yamlValue(video.like_count)}`);
  lines.push(`share_count: ${yamlValue(video.share_count)}`);
  lines.push(`ai_relevance_score: ${yamlValue(video.ai_relevance_score)}`);
  lines.push(`tags: [${tags.map((t) => yamlValue(t)).join(', ')}]`);
  lines.push(`vault_created_at: ${yamlValue(new Date())}`);
  lines.push(`vault_transcript_source: ${yamlValue(transcriptSource)}`);
  lines.push(`validation_status: ${yamlValue(video.validation_status)}`);
  lines.push(`validation_accuracy_score: ${yamlValue(video.validation_accuracy_score)}`);
  lines.push(`validation_claims_count: ${yamlValue(video.validation_claims_count)}`);
  lines.push(`validation_sources_count: ${yamlValue(video.validation_sources_count)}`);
  lines.push('---');
  return lines.join('\n');
}

/** Render the claim-by-claim section. */
function renderClaims(claims: Claim[]): string {
  if (claims.length === 0) {
    return '_No claims were extracted or validated._';
  }
  const lines: string[] = [];
  for (const c of claims) {
    lines.push(`### ${c.id}: ${c.status ?? 'unverifiable'}`);
    lines.push('');
    lines.push(`> ${c.text}`);
    lines.push('');
    if (c.source_url) {
      lines.push(`- **Source:** ${c.source_url}`);
    }
    if (c.evidence) {
      lines.push(`- **Evidence:** ${c.evidence.slice(0, 500)}${c.evidence.length > 500 ? '…' : ''}`);
    }
    if (c.notes) {
      lines.push(`- **Notes:** ${c.notes}`);
    }
    if (c.context) {
      lines.push(`- **Context:** ${c.context}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Extract the first few sentences as "Key Points" from the transcript. */
function buildKeyPoints(transcript: string): string {
  const sentences = transcript.match(/[^.!?]+[.!?]+/g) ?? [];
  const points = sentences.slice(0, 5).map((s) => `- ${s.trim()}`);
  return points.length > 0 ? points.join('\n') : '_No key points extracted._';
}

/**
 * Write the vault Markdown note for a video.
 *
 * @param video       The video row (with updated validation fields).
 * @param transcript  The transcript result.
 * @param report      The validation report (may be null if validation skipped).
 * @returns           The absolute path of the written file.
 */
export async function writeVault(
  video: Video,
  transcript: TranscriptResult,
  report: ValidationReport | null,
): Promise<string> {
  const vaultPath = process.env.VAULT_PATH ?? '/data/vault';
  await mkdir(vaultPath, { recursive: true });

  const tags = assignTags(video);
  const frontmatter = buildFrontmatter(video, tags, transcript.source);

  const sections: string[] = [];
  sections.push(frontmatter);
  sections.push('');
  sections.push(`# ${video.caption ?? video.video_id}`);
  sections.push('');
  sections.push(`By [@${video.creator_handle}](https://www.tiktok.com/@${video.creator_handle})`);
  sections.push('');

  // Key Points
  sections.push('## Key Points');
  sections.push('');
  sections.push(buildKeyPoints(transcript.text));
  sections.push('');

  // Transcript
  sections.push('## Transcript');
  sections.push('');
  sections.push(`*Source: ${transcript.source} (${transcript.word_count} words)*`);
  sections.push('');
  sections.push(transcript.text);
  sections.push('');

  // Deep Research Validation
  sections.push('## Deep Research Validation');
  sections.push('');

  if (report) {
    sections.push('### Summary');
    sections.push('');
    sections.push(`**Accuracy score: ${report.accuracy_score}%** across ${report.claims.length} claim(s).`);
    sections.push('');
    sections.push(report.summary);
    sections.push('');

    sections.push('### Claim-by-Claim');
    sections.push('');
    sections.push(renderClaims(report.claims));
    sections.push('');

    sections.push('### Sources');
    sections.push('');
    if (report.sources.length > 0) {
      for (const s of report.sources) {
        sections.push(`- ${s}`);
      }
    } else {
      sections.push('_No sources consulted._');
    }
    sections.push('');

    sections.push('### Corrections & Gaps');
    sections.push('');
    if (report.corrections.length > 0) {
      for (const c of report.corrections) {
        sections.push(`- ${c}`);
      }
    } else {
      sections.push('_No contradictions found._');
    }
    sections.push('');
  } else {
    sections.push('_Validation was skipped for this video._');
    sections.push('');
  }

  // Notes
  sections.push('## Notes');
  sections.push('');
  sections.push('<!-- Add your own notes here -->');
  sections.push('');

  const content = sections.join('\n');
  const filePath = join(vaultPath, `${video.video_id}.md`);
  await writeFile(filePath, content, 'utf8');

  // Update transcript_path in the DB.
  await updateVideoStatus(video.video_id, { transcript_path: filePath });

  console.log(`[vault-writer] wrote ${filePath}`);
  return filePath;
}
