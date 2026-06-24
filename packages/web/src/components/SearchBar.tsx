'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Video } from '@nyxtok/shared';
import { searchVideosApi } from '@/lib/api';

/**
 * Search bar with a live dropdown of results.
 *
 * Calls GET /api/search?q=... (debounced 300ms) and renders a dropdown of
 * matching videos. Also links to the dedicated /search page.
 */
export default function SearchBar({
  onSelect,
}: {
  onSelect?: (video: Video) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchVideosApi(q, 10);
        setResults(res.videos);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
          🔍
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search creators, hashtags, captions…"
          className="w-full rounded-full border border-gray-700 bg-gray-900 py-2.5 pl-9 pr-4 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-nyx-accent2"
        />
      </div>

      {open && (query.trim() || loading) && (
        <div className="absolute z-30 mt-1 max-h-[60vh] w-full overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 shadow-xl">
          {loading && (
            <p className="px-4 py-3 text-sm text-gray-500">Searching…</p>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <p className="px-4 py-3 text-sm text-gray-500">No matches.</p>
          )}
          {!loading &&
            results.map((v) => (
              <button
                key={v.video_id}
                type="button"
                onClick={() => {
                  onSelect?.(v);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 border-b border-gray-800 px-3 py-2.5 text-left transition hover:bg-gray-800"
              >
                <div className="flex h-12 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-gray-800">
                  {v.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={v.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span>▶</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-100">
                    @{v.creator_handle}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {v.caption ?? v.hashtags ?? '—'}
                  </p>
                </div>
              </button>
            ))}
          {open && query.trim() && (
            <Link
              href={`/search?q=${encodeURIComponent(query.trim())}`}
              className="block px-4 py-2.5 text-center text-xs font-medium text-nyx-accent2 hover:underline"
              onClick={() => setOpen(false)}
            >
              See all results →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
