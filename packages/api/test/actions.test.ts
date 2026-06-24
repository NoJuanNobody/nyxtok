/**
 * POST /api/videos/:video_id/{like,bookmark,dismiss} integration tests.
 * Issue #21: like sets is_liked + enqueues job; bookmark merges tags; dismiss
 * sets user_status; 404 for unknown video.
 *
 * The DB layer (@nyxtok/shared) and the queue/orchestrator are mocked so tests
 * run without Postgres or external services.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

// --- Mock the queue/orchestrator so no real pipeline runs ---
const { mockEnqueue } = vi.hoisted(() => ({ mockEnqueue: vi.fn() }));
vi.mock('../src/queue', () => ({
  enqueueTranscriptJob: mockEnqueue,
  getQueuedJobs: vi.fn(() => []),
  isQueued: vi.fn(() => false),
  runningCount: vi.fn(() => 0),
}));

import { buildServer } from '../src/server';
import type { FastifyInstance } from 'fastify';
import type { Video } from '@nyxtok/shared';

function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    video_id: 'vid1',
    creator_handle: 'creator',
    creator_id: '1',
    caption: 'caption',
    hashtags: 'AI;ML',
    view_count: 1000,
    like_count: 100,
    share_count: 10,
    comment_count: 5,
    duration_seconds: 30,
    ai_relevance_score: 0.8,
    discovered_at: new Date(),
    published_at: new Date(),
    download_status: 'completed',
    download_error: null,
    download_url: null,
    thumbnail_url: null,
    transcript_status: 'pending',
    transcript_error: null,
    transcript_path: null,
    validation_status: 'pending',
    validation_accuracy_score: null,
    validation_claims_count: null,
    validation_sources_count: null,
    user_status: 'unwatched',
    is_liked: false,
    is_bookmarked: false,
    watch_later: false,
    tags: '',
    updated_at: new Date(),
    ...overrides,
  };
}

describe('Actions: like / bookmark / dismiss', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGetVideo.mockReset();
    mockUpdateVideoStatus.mockReset();
    mockEnqueue.mockReset();
    app = await buildServer();
  });

  // -------------------------------------------------------------------------
  // LIKE
  // -------------------------------------------------------------------------

  it('like sets is_liked=true and enqueues a transcript job when transcript is pending', async () => {
    const video = makeVideo({ transcript_status: 'pending' });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockResolvedValue({
      ...video,
      is_liked: true,
      user_status: 'liked',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/vid1/like',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_liked).toBe(true);
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      'vid1',
      expect.objectContaining({ is_liked: true, user_status: 'liked' }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith('vid1');
  });

  it('like does not enqueue a job when transcript is already completed', async () => {
    const video = makeVideo({ transcript_status: 'completed' });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockResolvedValue({
      ...video,
      is_liked: true,
      user_status: 'liked',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/vid1/like',
    });

    expect(res.statusCode).toBe(200);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('like with action=unlike sets is_liked=false', async () => {
    const video = makeVideo({ is_liked: true });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockResolvedValue({
      ...video,
      is_liked: false,
      user_status: 'unwatched',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/vid1/like',
      payload: { action: 'unlike' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().is_liked).toBe(false);
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      'vid1',
      expect.objectContaining({ is_liked: false, user_status: 'unwatched' }),
    );
  });

  it('like returns 404 for unknown video', async () => {
    mockGetVideo.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/unknown/like',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // BOOKMARK
  // -------------------------------------------------------------------------

  it('bookmark sets is_bookmarked=true and merges tags', async () => {
    const video = makeVideo({ tags: 'AI;research' });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockResolvedValue({
      ...video,
      is_bookmarked: true,
      user_status: 'bookmarked',
      tags: 'AI;research;GPT',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/vid1/bookmark',
      payload: { manual_tags: ['GPT', 'AI'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.is_bookmarked).toBe(true);
    expect(body.tags).toEqual(['AI', 'research', 'GPT']);
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      'vid1',
      expect.objectContaining({
        is_bookmarked: true,
        user_status: 'bookmarked',
        tags: 'AI;research;GPT',
      }),
    );
  });

  it('bookmark returns 404 for unknown video', async () => {
    mockGetVideo.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/unknown/bookmark',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // DISMISS
  // -------------------------------------------------------------------------

  it('dismiss sets user_status=dismissed', async () => {
    const video = makeVideo({ user_status: 'unwatched' });
    mockGetVideo.mockResolvedValue(video);
    mockUpdateVideoStatus.mockResolvedValue({
      ...video,
      user_status: 'dismissed',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/vid1/dismiss',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user_status).toBe('dismissed');
    expect(mockUpdateVideoStatus).toHaveBeenCalledWith(
      'vid1',
      expect.objectContaining({ user_status: 'dismissed' }),
    );
  });

  it('dismiss returns 404 for unknown video', async () => {
    mockGetVideo.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/videos/unknown/dismiss',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
