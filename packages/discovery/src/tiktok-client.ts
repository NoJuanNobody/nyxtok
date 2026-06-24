/**
 * TikTok search abstraction.
 *
 * Issue #8: uses yt-dlp to search TikTok by hashtag / keyword and extract
 * metadata without downloading any video bytes.
 *
 * yt-dlp can dump metadata for TikTok URLs via `--dump-json` (one JSON object
 * per line). We issue a search URL and parse the resulting JSON stream into the
 * normalized `TikTokVideoMeta` shape consumed by the rest of the discovery
 * pipeline.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Maximum number of search results to request from yt-dlp. */
const SEARCH_LIMIT = Number(process.env.TIKTOK_SEARCH_LIMIT ?? 30);

/** A single normalized TikTok video metadata record. */
export interface TikTokVideoMeta {
  video_id: string;
  creator_handle: string;
  creator_id: string;
  caption: string;
  hashtags: string[];
  view_count: number;
  like_count: number;
  share_count: number;
  comment_count: number;
  duration_seconds: number;
  published_at: string;
  thumbnail_url: string;
}

/** Raw yt-dlp JSON shape (only the fields we read). */
interface YtDlpJson {
  id?: string;
  webpage_url?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  channel_id?: string;
  title?: string;
  description?: string;
  tags?: string[] | null;
  view_count?: number | null;
  like_count?: number | null;
  repost_count?: number | null;
  comment_count?: number | null;
  duration?: number | null;
  upload_date?: string | null;
  timestamp?: number | null;
  thumbnail?: string | null;
  thumbnails?: Array<{ url?: string }> | null;
}

/** Convert a YYYYMMDD string from yt-dlp into an ISO timestamp. */
function parseUploadDate(raw: string | null | undefined): string {
  if (!raw || raw.length !== 8) {
    return new Date().toISOString();
  }
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const iso = `${y}-${m}-${d}T00:00:00Z`;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? new Date().toISOString() : new Date(ts).toISOString();
}

/** Pick the best thumbnail URL from yt-dlp output. */
function pickThumbnail(j: YtDlpJson): string {
  if (Array.isArray(j.thumbnails) && j.thumbnails.length > 0) {
    for (const t of j.thumbnails) {
      if (t?.url) return t.url;
    }
  }
  return j.thumbnail ?? '';
}

/** Normalize a single yt-dlp JSON record into TikTokVideoMeta. */
function normalize(j: YtDlpJson): TikTokVideoMeta | null {
  const video_id = j.id ?? j.webpage_url ?? '';
  if (!video_id) return null;

  // yt-dlp returns hashtags in `tags` (without leading #) for TikTok.
  const tags = Array.isArray(j.tags) ? j.tags.filter(Boolean) : [];

  return {
    video_id,
    creator_handle: j.uploader ?? j.channel ?? j.uploader_id ?? '',
    creator_id: j.uploader_id ?? j.channel_id ?? '',
    caption: j.title ?? j.description ?? '',
    hashtags: tags,
    view_count: j.view_count ?? 0,
    like_count: j.like_count ?? 0,
    share_count: j.repost_count ?? 0,
    comment_count: j.comment_count ?? 0,
    duration_seconds: j.duration ?? 0,
    published_at: parseUploadDate(j.upload_date),
    thumbnail_url: pickThumbnail(j),
  };
}

/** Run yt-dlp against a TikTok URL and parse the JSON stream. */
async function runYtDlp(url: string): Promise<TikTokVideoMeta[]> {
  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--dump-json',
      '--flat-playlist',
      `--playlist-end=${SEARCH_LIMIT}`,
      '--no-warnings',
      '--no-progress',
      url,
    ], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    });

    const out: TikTokVideoMeta[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as YtDlpJson;
        const meta = normalize(parsed);
        if (meta) out.push(meta);
      } catch {
        // Skip malformed lines (yt-dlp sometimes interleaves log output).
      }
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tiktok-client] yt-dlp failed for ${url}: ${msg}`);
    return [];
  }
}

export class TikTokClient {
  /** Search TikTok by hashtag (without the leading #). */
  async searchByHashtag(hashtag: string): Promise<TikTokVideoMeta[]> {
    const clean = hashtag.replace(/^#/, '').trim();
    if (!clean) return [];
    const url = `https://www.tiktok.com/tag/${encodeURIComponent(clean)}`;
    console.log(`[tiktok-client] searching hashtag #${clean} -> ${url}`);
    return runYtDlp(url);
  }

  /** Search TikTok by free-text keyword. */
  async searchByKeyword(keyword: string): Promise<TikTokVideoMeta[]> {
    const clean = keyword.trim();
    if (!clean) return [];
    // yt-dlp supports TikTok search via the q= query parameter.
    const url = `https://www.tiktok.com/search?q=${encodeURIComponent(clean)}`;
    console.log(`[tiktok-client] searching keyword "${clean}" -> ${url}`);
    return runYtDlp(url);
  }
}

/** Default singleton client instance. */
export const tiktokClient = new TikTokClient();
