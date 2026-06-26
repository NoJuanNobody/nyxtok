/**
 * Ensure a playable local copy of a video exists, downloading on demand.
 *
 * Proxying TikTok CDN URLs directly does not work: `playAddr` URLs are signed,
 * short-lived, and bound to the session/cookies that fetched them, so the API
 * server gets 403/404 when it re-fetches them later. Instead we let yt-dlp —
 * which replays the right headers/cookies — download the file once to local
 * disk, then serve it from disk with full HTTP Range (seeking) support.
 *
 * Downloads are cached on disk and deduped in-memory so the many Range requests
 * a `<video>` element fires share a single download.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/** Directory for downloaded video files (mounted volume in the container). */
const DATA_DIR = process.env.VIDEO_DATA_DIR ?? '/data/videos';

/** Video ids with a download currently in flight (dedup concurrent requests). */
const inflight = new Map<string, Promise<string>>();

/** Canonical TikTok video page URL from a creator handle + video id. */
export function tiktokPageUrl(creatorHandle: string, videoId: string): string {
  const handle = creatorHandle.replace(/^@/, '');
  return `https://www.tiktok.com/@${handle}/video/${videoId}`;
}

/** True if `path` points at a non-empty file. */
async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

/** Download a TikTok video to `dest` via yt-dlp. */
async function runDownload(pageUrl: string, dest: string): Promise<void> {
  await execFileAsync(
    'yt-dlp',
    [
      // Prefer a single progressive stream that has BOTH audio and video;
      // fall back to merging best video+audio, then to anything. TikTok's
      // plain "best" sometimes resolves to an audio-less h265 variant, which
      // also plays poorly in browsers — see -S below.
      '-f',
      'best*[acodec!=none][vcodec!=none]/bestvideo+bestaudio/best',
      // Sort preferences: h264 (broad browser support) over h265, then up to
      // 1080p, then a real audio codec. Keeps playback compatible + audible.
      '-S',
      'vcodec:h264,res:1080,acodec:aac',
      '--merge-output-format',
      'mp4',
      '-o',
      dest,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--no-part',
      pageUrl,
    ],
    { timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (!(await fileExists(dest))) {
    throw new Error('yt-dlp finished but no output file was produced');
  }
}

/**
 * Ensure a local mp4 exists for `videoId`, downloading from `pageUrl` if needed.
 * Returns the absolute path to the playable file. Concurrent callers for the
 * same video share one download.
 */
export async function ensureLocalVideo(
  videoId: string,
  pageUrl: string,
): Promise<string> {
  const dest = join(DATA_DIR, `${videoId}.mp4`);

  if (await fileExists(dest)) {
    return dest;
  }

  const existing = inflight.get(videoId);
  if (existing) return existing;

  const promise = (async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await runDownload(pageUrl, dest);
    return dest;
  })().finally(() => {
    inflight.delete(videoId);
  });

  inflight.set(videoId, promise);
  return promise;
}
