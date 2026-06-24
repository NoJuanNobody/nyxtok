/**
 * GET /api/feed integration tests.
 * Issue #21: paginated results, limit/offset, dismissed exclusion, 400 on
 * invalid params.
 *
 * The DB layer (@nyxtok/shared) is mocked so these tests run without a live
 * Postgres. Fastify's `inject` is used to exercise the real route handler.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// --- Mock the shared DB layer (hoisted so vi.mock factories can reference them) ---
const { mockGetFeed } = vi.hoisted(() => ({
  mockGetFeed: vi.fn(),
}));

vi.mock('@nyxtok/shared', () => ({
  getFeed: mockGetFeed,
  getVideo: vi.fn(),
  searchVideos: vi.fn(),
  updateVideoStatus: vi.fn(),
  upsertVideo: vi.fn(),
  db: {},
  postgres: vi.fn(),
  loadConfig: vi.fn(),
}));

import { buildServer } from '../src/server';
import type { FastifyInstance } from 'fastify';
import type { Video } from '@nyxtok/shared';

// --- Fixtures ---
function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    video_id: '1',
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
    tags: null,
    updated_at: new Date(),
    ...overrides,
  };
}

describe('GET /api/feed', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGetFeed.mockReset();
    app = await buildServer();
  });

  it('returns paginated results with default limit/offset', async () => {
    const videos = [makeVideo({ video_id: 'a' }), makeVideo({ video_id: 'b' })];
    mockGetFeed.mockResolvedValue({ videos, total_count: 2 });

    const res = await app.inject({ method: 'GET', url: '/api/feed' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.videos).toHaveLength(2);
    expect(body.total_count).toBe(2);
    expect(body.offset).toBe(0);
    expect(body.limit).toBe(20);
    // Default exclude_statuses=['dismissed'] is passed to getFeed.
    expect(mockGetFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        offset: 0,
        limit: 20,
        exclude_statuses: ['dismissed'],
        sort: 'discovered_at',
      }),
    );
  });

  it('respects limit and offset query params', async () => {
    mockGetFeed.mockResolvedValue({ videos: [], total_count: 100 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?limit=5&offset=10',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.offset).toBe(10);
    expect(body.limit).toBe(5);
    expect(mockGetFeed).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 10, limit: 5 }),
    );
  });

  it('caps limit at 100', async () => {
    mockGetFeed.mockResolvedValue({ videos: [], total_count: 0 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?limit=500',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().limit).toBe(100);
  });

  it('excludes dismissed by default (exclude_statuses defaults to ["dismissed"])', async () => {
    mockGetFeed.mockResolvedValue({ videos: [], total_count: 0 });

    await app.inject({ method: 'GET', url: '/api/feed' });

    expect(mockGetFeed).toHaveBeenCalledWith(
      expect.objectContaining({ exclude_statuses: ['dismissed'] }),
    );
  });

  it('allows overriding exclude_statuses', async () => {
    mockGetFeed.mockResolvedValue({ videos: [], total_count: 0 });

    await app.inject({
      method: 'GET',
      url: '/api/feed?exclude_statuses=liked,bookmarked',
    });

    expect(mockGetFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        exclude_statuses: ['liked', 'bookmarked'],
      }),
    );
  });

  it('returns 400 on invalid limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?limit=abc',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 on invalid (negative) offset', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?offset=-1',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 on invalid sort', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?sort=invalid',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 on out-of-range min_relevance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/feed?min_relevance=1.5',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_FAILED');
  });
});
