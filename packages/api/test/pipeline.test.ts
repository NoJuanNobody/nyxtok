/**
 * Pipeline integration tests (mock Groq).
 * Issue #21: like triggers transcription (mock Groq API), vault file is created
 * with correct structure, DB status updates correctly.
 *
 * The Groq client and ffmpeg/yt-dlp (child_process) are mocked so no network or
 * binary calls happen, while the real transcribe + vault-writer logic runs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Mock shared DB (hoisted) ---
const { mockGetVideo, mockUpdateVideoStatus } = vi.hoisted(() => ({
  mockGetVideo: vi.fn(),
  mockUpdateVideoStatus: vi.fn(),
}));

vi.mock('@nyxtok/shared', () => ({
  getVideo: mockGetVideo,
  updateVideoStatus: mockUpdateVideoStatus,
  getFeed: vi.fn(),
  searchVideos: vi.fn(),
  upsertVideo: vi.fn(),
  db: {},
  postgres: vi.fn(),
  loadConfig: vi.fn(),
}));

// --- Mock Groq client (transcription + chat) ---
const { mockGroqTranscribe, mockGroqChat } = vi.hoisted(() => ({
  mockGroqTranscribe: vi.fn(),
  mockGroqChat: vi.fn(),
}));
vi.mock('../src/pipeline/groq-client', () => ({
  groqTranscribe: mockGroqTranscribe,
  groqChat: mockGroqChat,
  WHISPER_MODEL: 'whisper-large-v3',
  DEFAULT_CHAT_MODEL: 'llama-3.3-70b',
}));

// --- Mock child_process.execFile so ffmpeg / yt-dlp don't run ---
// transcribe uses promisify(execFile); we make every call resolve (no-op).
// extractAudio writes the output wav; we simulate by creating an empty file.
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// --- Mock the queue/orchestrator so the like route doesn't run a real pipeline ---
const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn() }));
vi.mock('../src/queue', () => ({
  enqueueTranscriptJob: mockEnqueue,
  getQueuedJobs: vi.fn(() => []),
  isQueued: vi.fn(() => false),
  runningCount: vi.fn(() => 0),
}));

// Fixtures
const transcriptText = readFileSync(
  join(__dirname, 'fixtures', 'transcript.txt'),
  'utf8',
);
const videoMeta = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'video-meta.json'), 'utf8'),
);

import { buildServer } from '../src/server';
import { writeVault } from '../src/pipeline/vault-writer';
import { transcribe } from '../src/pipeline/transcribe';
import type { FastifyInstance } from 'fastify';
import type { Video, TranscriptResult, Claim, ValidationReport } from '@nyxtok/shared';

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    video_id: '7234567890123456789',
    creator_handle: 'airesearcher',
    creator_id: '7012345678901234567',
    caption: 'GPT-5 is coming and here is what we know so far',
    hashtags: 'AI;GPT;ChatGPT;MachineLearning;LLM',
    view_count: 1_250_000,
    like_count: 245_000,
    share_count: 18_200,
    comment_count: 4_300,
    duration_seconds: 58,
    ai_relevance_score: 0.9,
    discovered_at: new Date('2024-06-20T15:00:00Z'),
    published_at: new Date('2024-06-20T14:30:00Z'),
    download_status: 'completed',
    download_error: null,
    download_url: '/data/media/7234567890123456789.mp4',
    thumbnail_url: 'https://example.com/thumb.jpeg',
    transcript_status: 'pending',
    transcript_error: null,
    transcript_path: null,
    validation_status: 'pending',
    validation_accuracy_score: null,
    validation_claims_count: null,
    validation_sources_count: null,
    user_status: 'liked',
    is_liked: true,
    is_bookmarked: false,
    watch_later: false,
    tags: '',
    updated_at: new Date(),
    ...overrides,
  };
}

describe('Pipeline: transcription -> vault (mock Groq)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGetVideo.mockReset();
    mockUpdateVideoStatus.mockReset();
    mockGroqTranscribe.mockReset();
    mockGroqChat.mockReset();
    mockExecFile.mockReset();
    mockEnqueue.mockReset();
    app = await buildServer();
  });

  it('like triggers transcription (mock Groq) and enqueues the pipeline', async () => {
    const video = makeVideo({ transcript_status: 'pending' });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockImplementation((_id, updates) =>
      Promise.resolve({ ...video, ...updates }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/videos/${video.video_id}/like`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_liked).toBe(true);
    // The like route enqueues a transcript job when transcript_status === 'pending'.
    expect(mockEnqueue).toHaveBeenCalledWith(video.video_id);
  });

  it('vault file is created with correct structure', async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), 'nyxtok-vault-test-'));
    process.env.VAULT_PATH = vaultDir;

    const video = makeVideo({
      transcript_status: 'completed',
      validation_status: 'completed',
      validation_accuracy_score: 50,
      validation_claims_count: 1,
      validation_sources_count: 1,
    });

    const transcript: TranscriptResult = {
      text: transcriptText,
      word_count: transcriptText.split(/\s+/).filter(Boolean).length,
      source: 'whisper',
    };

    const claim: Claim = {
      id: 'claim-1',
      text: 'GPT-5 will be released by the end of the year.',
      context: 'So GPT-5 is reportedly going to be released',
      status: 'verified',
      source_url: 'https://example.com/source',
      evidence: 'OpenAI confirmed the release timeline.',
      notes: 'Corroborated by multiple sources.',
    };

    const report: ValidationReport = {
      accuracy_score: 50,
      claims: [claim],
      summary: 'Validation summary.',
      sources: ['https://example.com/source'],
      corrections: [],
    };

    // updateVideoStatus is called by writeVault to persist transcript_path.
    mockUpdateVideoStatus.mockImplementation(async (_id, updates) => ({
      ...video,
      ...updates,
    }));

    const filePath = await writeVault(video, transcript, report);

    // File exists.
    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toBe(join(vaultDir, `${video.video_id}.md`));

    const content = readFileSync(filePath, 'utf8');

    // YAML frontmatter.
    expect(content.startsWith('---')).toBe(true);
    expect(content).toContain('title:');
    expect(content).toContain('creator: airesearcher');
    // tiktok_url is YAML-quoted because it contains ':'.
    expect(content).toContain(`tiktok_url: "https://www.tiktok.com/@airesearcher/video/${video.video_id}"`);
    expect(content).toContain('view_count: 1250000');
    expect(content).toContain('validation_status: completed');

    // Sections.
    expect(content).toContain('# GPT-5 is coming and here is what we know so far');
    expect(content).toContain('## Key Points');
    expect(content).toContain('## Transcript');
    expect(content).toContain('*Source: whisper');
    expect(content).toContain(transcriptText.trim());
    expect(content).toContain('## Deep Research Validation');
    expect(content).toContain('### Summary');
    expect(content).toContain('**Accuracy score: 50%** across 1 claim(s).');
    expect(content).toContain('### Claim-by-Claim');
    expect(content).toContain('### Sources');
    expect(content).toContain('### Corrections & Gaps');
    expect(content).toContain('https://example.com/source');

    // Tags: AI, MachineLearning, LLM, GPT, ChatGPT all match the taxonomy.
    expect(content).toMatch(/tags: \[[^\]]*AI[^\]]*\]/);

    // transcript_path persisted to DB.
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      video.video_id,
      expect.objectContaining({ transcript_path: filePath }),
    );

    rmSync(vaultDir, { recursive: true, force: true });
  });

  it('DB status updates correctly through the pipeline (real transcribe, mock Groq)', async () => {
    const video = makeVideo({ transcript_status: 'pending' });

    // Track updates so the mock returns progressively-updated video state.
    let current: Video = { ...video };
    mockGetVideo.mockImplementation(async () => ({ ...current }));
    mockUpdateVideoStatus.mockImplementation(async (_id, updates) => {
      current = { ...current, ...updates };
      return current;
    });

    // Groq Whisper returns the transcript text.
    mockGroqTranscribe.mockResolvedValue(transcriptText);

    // execFile stub: simulate ffmpeg writing the wav file, and yt-dlp being unused.
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null) => void) => {
      // ffmpeg writes to the 2nd-to-last arg (the output path) — create it so
      // the subsequent readFile in groqTranscribe doesn't fail.
      const outArg = args && args[args.length - 1];
      if (outArg && outArg.endsWith('.wav')) {
        try {
          mkdirSync(join(outArg, '..'), { recursive: true });
          writeFileSync(outArg, 'fake-wav');
        } catch {
          /* ignore */
        }
      }
      cb(null);
    });

    const out = await transcribe(video);

    expect(out.source).toBe('whisper');
    // The text is cleaned (filler-word removal, paragraph formatting) but the
    // substantive content from the Groq transcript is preserved.
    expect(out.text).toContain('GPT-5 is reportedly going to be released');
    expect(out.text).toContain('process reward models');
    expect(out.text).toContain('ten billion');
    expect(out.word_count).toBeGreaterThan(0);

    // transcribe sets transcript_status=in_progress then =completed.
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      video.video_id,
      expect.objectContaining({ transcript_status: 'in_progress' }),
    );
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      video.video_id,
      expect.objectContaining({ transcript_status: 'completed' }),
    );
  });
});
