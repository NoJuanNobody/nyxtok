'use client';

import { Suspense } from 'react';
import AuthGate from '@/components/AuthGate';
import ToastProvider from '@/components/Toast';
import VideoFeed from '@/components/VideoFeed';

/**
 * Home route = the immersive vertical video feed.
 *
 * Wrapped in AuthGate (redirects to /login without a token) and ToastProvider
 * (so VideoCards can announce transcript-readiness).
 */
export default function HomePage() {
  return (
    <AuthGate>
      <ToastProvider>
        <Suspense fallback={null}>
          <VideoFeed />
        </Suspense>
      </ToastProvider>
    </AuthGate>
  );
}
