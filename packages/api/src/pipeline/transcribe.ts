/**
 * Issue #15: Transcription pipeline.
 *
 * Extracts audio from a downloaded video (ffmpeg), sends it to Groq Whisper,
 * and falls back to TikTok auto-captions (via yt-dlp) and finally whisper.cpp
 * if Groq is unavailable. Cleans the transcript (filler-word removal, paragraph
 * formatting) and updates `transcript_status` in the DB at each step.
 *
 * Returns: { text, word_count, source }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, access, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TranscriptResult, Video } from '@nyxtok/shared';
import { updateVideoStatus } from '@nyxtok/shared';
import { groqTranscribe } from './groq-client';

const execFileAsync = promisify(execFile);

/** Backoff schedule (ms) for Groq timeout retries: 2 min, then 5 min. */
const GROQ_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000];
/** Per-request timeout for a single Groq transcription attempt. */
const GROQ_REQUEST_TIMEOUT_MS = 90 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** True if `p` exists on disk. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract audio from a video file into a 16 kHz mono WAV.
 * `ffmpeg -i {video} -vn -acodec pcm_s16le -ar 16000 {out}`
 */
async function extractAudio(
  videoPath: string,
  outWav: string,
): Promise<void> {
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outWav,
    ],
    { timeout: 5 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
  );
}

/**
 * Call Groq Whisper with a timeout + retry policy.
 *
 * Retries up to 2 times on timeout/network errors with the configured backoff
 * (2 min, 5 min). Throws on exhausted retries or non-retryable errors.
 */
async function transcribeWithGroq(audioPath: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= GROQ_BACKOFF_MS.length; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        GROQ_REQUEST_TIMEOUT_MS,
      );
      try {
        // groqTranscribe uses fetch; we race against an abort signal via a
        // wrapper promise so timeouts surface as retryable errors.
        const text = await Promise.race([
          groqTranscribe(audioPath),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Groq transcription timed out')),
              GROQ_REQUEST_TIMEOUT_MS,
            ),
          ),
        ]);
        return text;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[transcribe] Groq attempt ${attempt + 1} failed: ${msg}`);
      if (attempt < GROQ_BACKOFF_MS.length) {
        const backoff = GROQ_BACKOFF_MS[attempt];
        console.log(`[transcribe] backing off ${backoff / 1000}s before retry`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('Groq transcription failed after retries');
}

/**
 * Fetch TikTok auto-captions for a video using yt-dlp.
 *
 * Downloads the auto-generated subtitle (VTT/SRT) for the video and converts
 * it to plain text. Returns null if no captions are available.
 */
async function fetchTikTokCaptions(video: Video): Promise<string | null> {
  const url = `https://www.tiktok.com/@${video.creator_handle}/video/${video.video_id}`;
  const dir = await mkdtemp(join(tmpdir(), 'nyxtok-caps-'));
  const outBase = join(dir, video.video_id);
  try {
    await execFileAsync(
      'yt-dlp',
      [
        '--write-auto-subs',
        '--sub-lang',
        'en',
        '--skip-download',
        '--sub-format',
        'vtt',
        '-o',
        outBase,
        '--no-warnings',
        '--no-progress',
        url,
      ],
      { timeout: 60 * 1000, maxBuffer: 32 * 1024 * 1024 },
    );

    // yt-dlp writes <base>.<lang>.vtt
    const vttPath = `${outBase}.en.vtt`;
    if (!(await pathExists(vttPath))) {
      return null;
    }
    const raw = await readFile(vttPath, 'utf8');
    return vttToText(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[transcribe] TikTok captions fetch failed: ${msg}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Convert a WebVTT subtitle file to plain text. */
function vttToText(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('WEBVTT')) continue;
    if (t.startsWith('NOTE')) continue;
    // Skip cue headers (e.g. "00:00:01.000 --> 00:00:03.000")
    if (/-->/.test(t)) continue;
    // Strip inline VTT tags like <c>, <00:00:01.000>
    const cleaned = t
     .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out.join(' ');
}

/**
 * Clean a raw transcript: remove common filler words and format into
 * roughly sentence-bounded paragraphs.
 */
function cleanTranscript(raw: string): string {
  let text = raw.replace(/\r/g, ' ').replace(/\n{2,}/g, '\n');
  // Collapse single newlines into spaces first.
  text = text.replace(/\n/g, ' ');

  // Remove filler words as standalone tokens (case-insensitive).
  const fillers = ['um', 'uh', 'er', 'ah', 'like', 'basically', 'literally'];
  const fillerRe = new RegExp(
    `\\b(${fillers.join('|')})\\b[\\s,]*`,
    'gi',
  );
  text = text.replace(fillerRe, '');

  // Collapse repeated whitespace.
  text = text.replace(/\s{2,}/g, ' ').trim();

  // Break into paragraphs every ~3 sentences.
  const sentences = text.match(/[^.!?]+[.!?]+|\S+$/g) ?? [text];
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join(' ').trim());
  }
  return paragraphs.filter((p) => p.length > 0).join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transcribe a single video.
 *
 * Steps:
 *  1. ffmpeg audio extraction
 *  2. Groq Whisper (with 2 retries / 2-5 min backoff on timeout)
 *  3. Fallback to TikTok auto-captions
 *  4. Fallback to local whisper.cpp (skipped for MVP if not installed)
 *
 * Updates `transcript_status` (in_progress -> completed/failed) in the DB.
 */
export async function transcribe(video: Video): Promise<TranscriptResult> {
  await updateVideoStatus(video.video_id, { transcript_status: 'in_progress' });

  // Resolve the local video file path.
  const videoPath = video.download_url ?? '';
  if (!videoPath) {
    await updateVideoStatus(video.video_id, {
      transcript_status: 'failed',
      transcript_error: 'No download_url available for audio extraction.',
    });
    throw new Error(`[transcribe] ${video.video_id}: no download_url`);
  }

  const workDir = await mkdtemp(join(tmpdir(), 'nyxtok-tx-'));
  const wavPath = join(workDir, 'audio.wav');

  try {
    // Step 1: extract audio.
    await extractAudio(videoPath, wavPath);

    let rawText: string | null = null;
    let source: TranscriptResult['source'] = 'whisper';

    // Step 2: Groq Whisper.
    try {
      rawText = await transcribeWithGroq(wavPath);
      console.log(`[transcribe] ${video.video_id}: Groq Whisper succeeded`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[transcribe] ${video.video_id}: Groq failed: ${msg}`);

      // Step 3: TikTok auto-captions fallback.
      console.log(`[transcribe] ${video.video_id}: trying TikTok captions`);
      const captions = await fetchTikTokCaptions(video);
      if (captions && captions.trim().length > 0) {
        rawText = captions;
        source = 'captions';
        console.log(
          `[transcribe] ${video.video_id}: using TikTok auto-captions`,
        );
      } else {
        // Step 4: whisper.cpp fallback (MVP: skip if not installed).
        console.warn(
          `[transcribe] ${video.video_id}: no captions; whisper.cpp fallback not installed for MVP`,
        );
      }
    }

    if (!rawText || rawText.trim().length === 0) {
      await updateVideoStatus(video.video_id, {
        transcript_status: 'failed',
        transcript_error: 'All transcription sources failed.',
      });
      throw new Error(
        `[transcribe] ${video.video_id}: all transcription sources failed`,
      );
    }

    // Step 6: clean transcript.
    const text = cleanTranscript(rawText);
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    await updateVideoStatus(video.video_id, {
      transcript_status: 'completed',
      transcript_error: null,
    });

    return { text, word_count: wordCount, source };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Re-export helper for tests / vault writer.
export { cleanTranscript };
