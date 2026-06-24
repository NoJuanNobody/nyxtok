/**
 * API client for the Nyxtok frontend.
 *
 * Thin fetch wrapper that:
 *  - auto-attaches the Bearer token stored in localStorage
 *  - prefixes relative paths (so Next.js rewrites proxy to the backend)
 *  - normalises errors into a typed ApiError
 *  - exposes typed helpers for every backend endpoint
 */
import type {
  BookmarkResponse,
  DismissResponse,
  FeedResponse,
  LikeResponse,
  SearchResponse,
  TranscriptResponse,
  Video,
} from '@nyxtok/shared';

/** localStorage key holding the bearer auth token. */
export const TOKEN_KEY = 'nyxtok_token';

/** Read the stored auth token (browser-only; returns null on the server). */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Persist / clear the auth token. */
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorResponseBody {
  error: boolean;
  code: string;
  message: string;
  details?: string;
}

/**
 * Core request helper. Throws ApiError on non-2xx responses.
 *
 * On 401 the token is assumed invalid and the caller is redirected to /login.
 */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch (err) {
    throw new ApiError(0, 'NETWORK_ERROR', (err as Error).message);
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    setToken(null);
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
  }

  if (!res.ok) {
    let body: ErrorResponseBody | null = null;
    try {
      body = (await res.json()) as ErrorResponseBody;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(
      res.status,
      body?.code ?? 'REQUEST_FAILED',
      body?.message ?? `Request failed (${res.status})`,
    );
  }

  // 204 / empty body
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// --- Typed endpoint helpers -------------------------------------------------

export function fetchFeed(
  offset = 0,
  limit = 10,
  opts: { sort?: string; exclude_statuses?: string } = {},
): Promise<FeedResponse> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (opts.sort) params.set('sort', opts.sort);
  if (opts.exclude_statuses) params.set('exclude_statuses', opts.exclude_statuses);
  return apiRequest<FeedResponse>(`/api/feed?${params.toString()}`);
}

export function searchVideosApi(q: string, limit = 20): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiRequest<SearchResponse>(`/api/search?${params.toString()}`);
}

export function likeVideo(
  videoId: string,
  unlike = false,
): Promise<LikeResponse> {
  return apiRequest<LikeResponse>(
    `/api/videos/${encodeURIComponent(videoId)}/like`,
    {
      method: 'POST',
      body: JSON.stringify(unlike ? { action: 'unlike' } : {}),
    },
  );
}

export function bookmarkVideo(
  videoId: string,
  unbookmark = false,
  manualTags: string[] = [],
): Promise<BookmarkResponse> {
  const body: Record<string, unknown> = {};
  if (unbookmark) body.action = 'unbookmark';
  if (manualTags.length) body.manual_tags = manualTags;
  return apiRequest<BookmarkResponse>(
    `/api/videos/${encodeURIComponent(videoId)}/bookmark`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function dismissVideo(videoId: string): Promise<DismissResponse> {
  return apiRequest<DismissResponse>(
    `/api/videos/${encodeURIComponent(videoId)}/dismiss`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export function fetchTranscript(
  videoId: string,
): Promise<TranscriptResponse> {
  return apiRequest<TranscriptResponse>(
    `/api/videos/${encodeURIComponent(videoId)}/transcript`,
  );
}

/** Relative URL for the streaming endpoint (proxied through Next rewrites). */
export function streamUrl(videoId: string): string {
  return `/api/videos/${encodeURIComponent(videoId)}/stream`;
}

export type {
  Video,
  FeedResponse,
  SearchResponse,
  TranscriptResponse,
  LikeResponse,
  BookmarkResponse,
  DismissResponse,
};
