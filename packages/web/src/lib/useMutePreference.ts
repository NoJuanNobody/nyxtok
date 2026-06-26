'use client';

import { useSyncExternalStore } from 'react';

/**
 * Global mute preference shared by every VideoCard.
 *
 * The user's mute/unmute choice is a single app-wide setting (like TikTok),
 * not a per-video toggle. We keep it in a module-level store so all mounted
 * cards stay in sync, and persist it to localStorage so it survives reloads.
 */

const STORAGE_KEY = 'nyxtok:muted';

// Default to unmuted. Note: browsers may block autoplay-with-sound until the
// user interacts with the page; the card's play().catch() handles that case.
let muted = false;
let hydrated = false;

const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored !== null) muted = stored === 'true';
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  // Sync changes made in other tabs.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue !== null) {
      muted = e.newValue === 'true';
      emit();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot() {
  return muted;
}

// Server render and first client render before hydration both default to unmuted.
function getServerSnapshot() {
  return false;
}

/** Update the global mute preference and notify every subscribed card. */
export function setMuted(next: boolean) {
  if (muted === next) return;
  muted = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  }
  emit();
}

/** Read the shared mute preference; re-renders the card when it changes. */
export function useMutePreference(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [value, setMuted];
}
