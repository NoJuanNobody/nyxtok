/**
 * TikTok search client — shells out to Python TikTokApi (playwright-based).
 *
 * yt-dlp cannot search TikTok by hashtag/keyword (unsupported URL formats),
 * so we use the TikTokApi Python library which drives a real Chromium browser
 * via Playwright. This avoids bot detection and returns full engagement metrics.
 *
 * The Python CLI (scripts/search.py) outputs one JSON object per line on stdout,
 * matching the same TikTokVideoMeta shape we use internally.
 *
 * yt-dlp is still used for:
 *   - Downloading videos (downloader.ts)
 *   - Individual video metadata enrichment (getVideoMeta)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/** Root directory of the nyxtok repo (where scripts/ lives). */
const REPO_ROOT = process.env.NYXTOK_ROOT ?? join(__dirname, '..', '..');

/** Path to the Python search script. */
const SEARCH_SCRIPT = join(REPO_ROOT, 'scripts', 'search.py');

/** Default number of videos to request per hashtag. */
const DEFAULT_COUNT = Number(process.env.TIKTOK_SEARCH_LIMIT ?? 30);

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
  /** Full TikTok webpage URL (needed for downloading). */
  url: string;
}

/** Raw yt-dlp JSON shape (for getVideoMeta). */
interface YtDlpJson {
  id?: string;
  webpage_url?: string;
  url?: string;
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

/** Build the full TikTok webpage URL for a video. */
function buildVideoUrl(j: YtDlpJson, handle: string): string {
  if (j.webpage_url) return j.webpage_url;
  const id = j.id ?? '';
  if (id && handle) {
    return `https://www.tiktok.com/@${handle}/video/${id}`;
  }
  return j.url ?? '';
}

/** Normalize a yt-dlp JSON record into TikTokVideoMeta. */
function normalizeYtDlp(j: YtDlpJson, handle?: string): TikTokVideoMeta | null {
  const video_id = j.id ?? j.webpage_url ?? '';
  if (!video_id) return null;

  const tags = Array.isArray(j.tags) ? j.tags.filter(Boolean) : [];
  const creator = handle ?? j.uploader ?? j.channel ?? j.uploader_id ?? '';

  return {
    video_id,
    creator_handle: creator,
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
    url: buildVideoUrl(j, creator),
  };
}

/** Parse a stdout stream of newline-delimited JSON into TikTokVideoMeta[]. */
function parseJsonStream(stdout: string): TikTokVideoMeta[] {
  const out: TikTokVideoMeta[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<TikTokVideoMeta>;
      if (parsed.video_id) {
        out.push({
          video_id: parsed.video_id,
          creator_handle: parsed.creator_handle ?? '',
          creator_id: parsed.creator_id ?? '',
          caption: parsed.caption ?? '',
          hashtags: parsed.hashtags ?? [],
          view_count: parsed.view_count ?? 0,
          like_count: parsed.like_count ?? 0,
          share_count: parsed.share_count ?? 0,
          comment_count: parsed.comment_count ?? 0,
          duration_seconds: parsed.duration_seconds ?? 0,
          published_at: parsed.published_at || new Date().toISOString(),
          thumbnail_url: parsed.thumbnail_url ?? '',
          url: parsed.url ?? '',
        });
      }
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}

export class TikTokClient {
  /**
   * Search TikTok by hashtag using the Python TikTokApi CLI.
   * Returns full metadata including view/like/comment/share counts.
   *
   * Requires: pip install TikTokApi playwright && python -m playwright install chromium
   */
  async searchByHashtag(hashtag: string): Promise<TikTokVideoMeta[]> {
    const clean = hashtag.replace(/^#/, '').trim();
    if (!clean) return [];
    console.log(`[tiktok-client] searching hashtag #${clean} (count=${DEFAULT_COUNT})`);

    try {
      const { stdout } = await execFileAsync('python3', [
        SEARCH_SCRIPT,
        '--hashtag', clean,
        '--count', String(DEFAULT_COUNT),
      ], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      });
      return parseJsonStream(stdout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tiktok-client] search.py failed for #${clean}: ${msg}`);
      return [];
    }
  }

  /**
   * Enrich a single video with full metadata (upload date) via yt-dlp.
   * The TikTokApi search doesn't reliably return upload dates, so we use
   * yt-dlp --skip-download to fill in the gap.
   */
  async getVideoMeta(videoUrl: string): Promise<TikTokVideoMeta | null> {
    console.log(`[tiktok-client] fetching metadata: ${videoUrl}`);

    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--dump-json',
        '--skip-download',
        '--no-warnings',
        '--no-progress',
        videoUrl,
      ], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60 * 1000,
      });

      const lines = stdout.split('\n').filter((l) => l.trim());
      if (lines.length === 0) return null;
      const parsed = JSON.parse(lines[0]) as YtDlpJson;
      return normalizeYtDlp(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tiktok-client] yt-dlp failed for ${videoUrl}: ${msg}`);
      return null;
    }
  }

  /**
   * List a creator's recent videos via yt-dlp flat-playlist.
   * Useful as a supplementary discovery method alongside hashtag search.
   */
  async listCreatorVideos(handle: string): Promise<TikTokVideoMeta[]> {
    const clean = handle.replace(/^@/, '').trim();
    if (!clean) return [];
    const url = `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
    console.log(`[tiktok-client] listing videos for @${clean}`);

    try {
      const { stdout } = await execFileAsync('yt-dlp', [
        '--flat-playlist',
        '--dump-json',
        `--playlist-end=${DEFAULT_COUNT}`,
        '--no-warnings',
        '--no-progress',
        url,
      ], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 3 * 60 * 1000,
      });

      const out: TikTokVideoMeta[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as YtDlpJson;
          const meta = normalizeYtDlp(parsed, clean);
          if (meta) out.push(meta);
        } catch {
          // Skip malformed lines.
        }
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tiktok-client] yt-dlp failed for @${clean}: ${msg}`);
      return [];
    }
  }
}

/** Default singleton client instance. */
export const tiktokClient = new TikTokClient();
