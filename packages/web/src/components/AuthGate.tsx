'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';

/**
 * Client-side auth gate.
 *
 * Wraps the authenticated app shell. On mount it checks localStorage for a
 * token; if none is present (and we're not already on /login) it redirects to
 * /login. Renders nothing until the check completes to avoid flashing
 * protected UI.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router, pathname]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin-slow rounded-full border-2 border-gray-700 border-t-gray-300" />
      </div>
    );
  }

  return <>{children}</>;
}
