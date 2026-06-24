'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Video } from '@nyxtok/shared';
import { fetchFeed } from '@/lib/api';
import VideoCard from './VideoCard';

const PAGE_SIZE = 10;

/**
 * Vertical, scroll-snapping feed of full-screen video cards.
 *
 * Implements:
 *  - CSS scroll-snap (one card per screen).
 *  - Infinite scroll: when the user nears the bottom we fetch the next page
 *    via GET /api/feed?offset=N.
 *  - Per-card dismiss: removed from the local list and (optionally) replaced
 *    by fetching one extra item to keep the feed full.
 */
export default function VideoFeed() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);

  // --- Initial load ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchFeed(0, PAGE_SIZE);
        if (cancelled) return;
        setVideos(res.videos);
        offsetRef.current = res.videos.length;
        setHasMore(res.videos.length < res.total_count);
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

  // --- Load next page ---
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchFeed(offsetRef.current, PAGE_SIZE);
      setVideos((prev) => {
        const existing = new Set(prev.map((v) => v.video_id));
        const fresh = res.videos.filter((v) => !existing.has(v.video_id));
        return [...prev, ...fresh];
      });
      offsetRef.current += res.videos.length;
      setHasMore(res.videos.length > 0 && offsetRef.current < res.total_count);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore]);

  // --- Infinite scroll: detect proximity to the bottom ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // Trigger when within 1.5 viewport heights of the end.
      if (scrollHeight - scrollTop - clientHeight < clientHeight * 1.5) {
        void loadMore();
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadMore]);

  const handleDismiss = useCallback((videoId: string) => {
    setVideos((prev) => prev.filter((v) => v.video_id !== videoId));
    // Refill one item to keep the feed scrollable.
    if (hasMore) void loadMore();
  }, [hasMore, loadMore]);

  // --- Render states ---
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-gray-700 border-t-gray-300" />
      </div>
    );
  }

  if (error && videos.length === 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-red-400">Couldn&apos;t load the feed.</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold">No videos yet</p>
        <p className="text-sm text-gray-500">
          The discovery pipeline hasn&apos;t surfaced any videos. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="no-scrollbar h-dvh w-full snap-y snap-mandatory overflow-y-scroll"
    >
      {videos.map((v) => (
        <VideoCard key={v.video_id} video={v} onDismiss={handleDismiss} />
      ))}
      {loadingMore && (
        <div className="flex h-16 items-center justify-center text-xs text-gray-500">
          <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-gray-700 border-t-gray-400" />
        </div>
      )}
    </div>
  );
}
