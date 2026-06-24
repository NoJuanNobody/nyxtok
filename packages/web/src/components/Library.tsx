'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Video } from '@nyxtok/shared';
import { fetchFeed } from '@/lib/api';

type FilterTab = 'all' | 'liked' | 'bookmarked' | 'dismissed';

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'liked', label: 'Liked' },
  { key: 'bookmarked', label: 'Bookmarked' },
  { key: 'dismissed', label: 'Dismissed' },
];

/**
 * Grid view of liked / bookmarked / dismissed videos.
 *
 * Fetches a large page of videos and filters client-side by user_status / flags.
 * Tapping a card opens the feed (where the full-screen player lives).
 */
export default function Library() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch with no status exclusion so we see liked/bookmarked/dismissed.
        const res = await fetchFeed(0, 100, { exclude_statuses: '' });
        if (cancelled) return;
        setVideos(res.videos);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'liked':
        return videos.filter((v) => v.is_liked);
      case 'bookmarked':
        return videos.filter((v) => v.is_bookmarked);
      case 'dismissed':
        return videos.filter((v) => v.user_status === 'dismissed');
      default:
        return videos;
    }
  }, [videos, tab]);

  const fmtCount = useCallback((n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n), []);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-gray-700 border-t-gray-300" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-gray-950 px-3 pb-20 pt-3">
      {/* Filter tabs */}
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t.key
                ? 'bg-nyx-accent text-white'
                : 'bg-gray-800 text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="py-8 text-center text-sm text-red-400">{error}</p>
      )}

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-gray-500">
          Nothing here yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((v) => (
            <Link
              key={v.video_id}
              href={`/?video=${encodeURIComponent(v.video_id)}`}
              className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-gray-900"
            >
              {v.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={v.thumbnail_url}
                  alt={v.caption ?? `@${v.creator_handle}`}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl text-gray-700">
                  ▶
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <div className="absolute bottom-1.5 left-1.5 right-1.5">
                <p className="truncate text-xs font-semibold text-white">
                  @{v.creator_handle}
                </p>
                <p className="truncate text-[10px] text-gray-300">
                  ♥ {fmtCount(v.like_count)} · ▶ {fmtCount(v.view_count)}
                </p>
              </div>
              <div className="absolute right-1.5 top-1.5 flex gap-1">
                {v.is_liked && (
                  <span className="rounded-full bg-nyx-accent/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    ♥
                  </span>
                )}
                {v.is_bookmarked && (
                  <span className="rounded-full bg-nyx-accent2/90 px-1.5 py-0.5 text-[9px] font-bold text-black">
                    🔖
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
