'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/api';

/**
 * Token entry page.
 *
 * The Nyxtok backend uses a single shared Bearer token (AUTH_TOKEN). The user
 * pastes it here; we store it in localStorage and redirect to the feed.
 */
export default function LoginPage() {
  const router = useRouter();
  const [token, setTokenInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError('Please enter your auth token.');
      return;
    }
    setSubmitting(true);
    setError(null);
    setToken(trimmed);
    router.replace('/');
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-gray-950 px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="bg-gradient-to-r from-nyx-accent to-nyx-accent2 bg-clip-text text-4xl font-extrabold text-transparent">
            Nyxtok
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            Enter your API bearer token to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-400">
              Auth token
            </span>
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="paste token…"
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-nyx-accent2 focus:ring-1 focus:ring-nyx-accent2"
            />
          </label>

          {error && (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-nyx-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
