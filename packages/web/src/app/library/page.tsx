'use client';

import { Suspense } from 'react';
import AuthGate from '@/components/AuthGate';
import ToastProvider from '@/components/Toast';
import Library from '@/components/Library';
import BottomNav from '@/components/BottomNav';

export default function LibraryPage() {
  return (
    <AuthGate>
      <ToastProvider>
        <main className="mx-auto max-w-2xl">
          <h1 className="px-3 pt-4 pb-1 text-lg font-bold">Library</h1>
          <Suspense fallback={null}>
            <Library />
          </Suspense>
        </main>
        <BottomNav />
      </ToastProvider>
    </AuthGate>
  );
}
