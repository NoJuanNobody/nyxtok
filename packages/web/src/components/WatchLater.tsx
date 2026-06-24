'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Video } from '@nyxtok/shared';
import { fetchFeed } from '@/lib/api';

/**
 * "Watch later" queue list.
 *
 * Renders the user's bookmarked videos as a vertical queue. Each item links
 * back into the immersive feed. This is a lightweight view — the canonical
 * bookmark set also appears under the Library &quot;Bookmarked&quot; tab, but
 * this surface is tuned for quick sequential playback.
 */
export default function WatchLater() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFeed(0, 100, { exclude_statuses: '' });
        if (cancelled) return;
        setVideos(res.videos.filter((v) => v.is_bookmarked));
      } catch {
        /* ignore; list stays empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin-slow rounded-full border-2 border-gray-700 border-t-gray-300" />
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-gray-500">
        No saved videos. Bookmark videos from the feed to build your watch-later queue.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-gray-800">
      {videos.map((v, i) => (
        <li key={v.video_id}>
          <Link
            href={`/?video=${encodeURIComponent(v.video_id)}`}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-gray-900"
          >
            <span className="w-5 text-center text-xs text-gray-500">
              {i + 1}
            </span>
            <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-800">
              {v.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.thumbnail_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-600">
                  ▶
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">@{v.creator_handle}</p>
              <p className="truncate text-xs text-gray-500">
                {v.caption ?? '—'}
              </p>
            </div>
            <span className="text-xs text-gray-600">
              {Math.round(v.duration_seconds)}s
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
