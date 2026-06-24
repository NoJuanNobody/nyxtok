/**
 * Video downloader — yt-dlp wrapper.
 *
 * Issue #10: downloads MP4 + thumbnail for a given TikTok video and updates
 * the database row's download_status / download_url / thumbnail_url.
 * Retries up to 2 times with a 5-minute delay between attempts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { updateVideoStatus } from '@nyxtok/shared';
import type { DownloadStatus } from '@nyxtok/shared';

const execFileAsync = promisify(execFile);

/** Root directory for downloaded videos and thumbnails. */
const DATA_DIR = process.env.VIDEO_DATA_DIR ?? '/data/videos';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ensure the data directory exists. */
async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

/**
 * Run yt-dlp to download the video (MP4) and its thumbnail (JPG).
 * Returns the local file paths.
 */
async function runYtDlpDownload(
  videoId: string,
  url: string,
): Promise<{ videoPath: string; thumbPath: string }> {
  await ensureDataDir();
  const videoPath = join(DATA_DIR, `${videoId}.mp4`);
  const thumbPath = join(DATA_DIR, `${videoId}.jpg`);

  // Download the best ≤1080p video + best audio, merged into MP4.
  await execFileAsync(
    'yt-dlp',
    [
      '-f',
      'bestvideo[height<=1080]+bestaudio',
      '--merge-output-format',
      'mp4',
      '--write-thumbnail',
      '--convert-thumbnails',
      'jpg',
      '-o',
      videoPath,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      url,
    ],
    {
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    },
  );

  return { videoPath, thumbPath };
}

/**
 * Download a TikTok video by id + source URL.
 *
 * Updates the DB row's download_status from `pending` to either `completed`
 * or `failed`, and records download_url + thumbnail_url on success. Retries
 * up to `MAX_RETRIES` times with `RETRY_DELAY_MS` between failures.
 */
export async function downloadVideo(
  videoId: string,
  url: string,
): Promise<{ success: boolean; status: DownloadStatus; error?: string }> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[downloader] ${videoId}: attempt ${attempt}/${MAX_RETRIES}`);

      const { videoPath, thumbPath } = await runYtDlpDownload(videoId, url);

      // Update DB: mark completed + store local paths.
      await updateVideoStatus(videoId, {
        download_status: 'completed',
        download_url: videoPath,
        thumbnail_url: thumbPath,
        download_error: null,
      });

      console.log(`[downloader] ${videoId}: completed -> ${videoPath}`);
      return { success: true, status: 'completed' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      console.error(`[downloader] ${videoId}: attempt ${attempt} failed: ${msg}`);

      if (attempt < MAX_RETRIES) {
        console.log(`[downloader] ${videoId}: retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted — mark failed in DB.
  try {
    await updateVideoStatus(videoId, {
      download_status: 'failed',
      download_error: lastError ?? 'unknown error',
    });
  } catch (dbErr) {
    const dbMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[downloader] ${videoId}: failed to update DB status: ${dbMsg}`);
  }

  return { success: false, status: 'failed', error: lastError };
}
