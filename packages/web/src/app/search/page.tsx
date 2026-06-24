'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Video } from '@nyxtok/shared';
import AuthGate from '@/components/AuthGate';
import ToastProvider from '@/components/Toast';
import BottomNav from '@/components/BottomNav';
import SearchBar from '@/components/SearchBar';
import WatchLater from '@/components/WatchLater';
import { searchVideosApi } from '@/lib/api';

function SearchResults() {
  const searchParams = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const [results, setResults] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await searchVideosApi(q, 50);
        if (!cancelled) setResults(res.videos);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  if (!q) return null;

  return (
    <div className="mt-3">
      {loading && (
        <p className="px-4 py-6 text-center text-sm text-gray-500">Searching…</p>
      )}
      {!loading && results.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-gray-500">
          No results for &quot;{q}&quot;.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 px-3 sm:grid-cols-3 md:grid-cols-4">
        {results.map((v) => (
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
                {v.caption ?? ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <AuthGate>
      <ToastProvider>
        <main className="mx-auto max-w-2xl px-3 pt-4 pb-20">
          <h1 className="mb-3 text-lg font-bold">Search</h1>
          <SearchBar />
          <Suspense fallback={null}>
            <SearchResults />
          </Suspense>

          <div className="mt-8">
            <h2 className="mb-2 px-1 text-sm font-semibold text-gray-400">
              Watch later
            </h2>
            <div className="overflow-hidden rounded-xl border border-gray-800">
              <WatchLater />
            </div>
          </div>
        </main>
        <BottomNav />
      </ToastProvider>
    </AuthGate>
  );
}
