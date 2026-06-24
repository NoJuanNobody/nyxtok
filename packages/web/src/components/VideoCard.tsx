'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BookmarkResponse,
  LikeResponse,
  TranscriptResponse,
  Video,
} from '@nyxtok/shared';
import {
  bookmarkVideo,
  dismissVideo,
  fetchTranscript,
  likeVideo,
  streamUrl,
} from '@/lib/api';
import { useToast } from './Toast';

interface VideoCardProps {
  video: Video;
  /** Called after a successful dismiss (so the feed can remove the card). */
  onDismiss?: (videoId: string) => void;
}

/**
 * A single full-screen vertical video card.
 *
 * - Auto-plays when scrolled into view (IntersectionObserver), pauses otherwise.
 * - Lazy-loads the video src only once the card has been near the viewport.
 * - Right-side action rail: Like, Bookmark, Dismiss (each optimistic + animated).
 * - Bottom-left overlay: creator handle, caption, hashtags, view/like counts.
 * - Transcript + validation badges (#14): polls the transcript endpoint every
 *   10s while pending; shows a toast when ready.
 */
export default function VideoCard({ video, onDismiss }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [srcLoaded, setSrcLoaded] = useState(false);
  const [muted, setMuted] = useState(true);

  // Local optimistic state mirrors of server-tracked flags.
  const [isLiked, setIsLiked] = useState(video.is_liked);
  const [isBookmarked, setIsBookmarked] = useState(video.is_bookmarked);
  const [likeCount, setLikeCount] = useState(video.like_count);

  // Action animation triggers.
  const [likeBump, setLikeBump] = useState(false);
  const [bookmarkBump, setBookmarkBump] = useState(false);

  // Dismiss slide-away.
  const [dismissing, setDismissing] = useState(false);

  // Transcript / validation status (#14).
  const [transcript, setTranscript] = useState<TranscriptResponse | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { showToast } = useToast();

  // --- IntersectionObserver: detect when this card is the active one --------
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setInView(entry.intersectionRatio >= 0.6);
      },
      { threshold: [0, 0.6, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Play / pause based on visibility -------------------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (inView) {
      void v.play().catch(() => {
        /* autoplay can be blocked; user can tap to play */
      });
    } else {
      v.pause();
    }
  }, [inView]);

  // --- Lazy-load the video src when near the viewport -----------------------
  useEffect(() => {
    if (srcLoaded) return;
    if (inView) setSrcLoaded(true);
  }, [inView, srcLoaded]);

  // --- Transcript polling (#14) ---------------------------------------------
  // Only poll for videos the user has liked or bookmarked — that's when the
  // pipeline actually runs. Uninteracted videos stay at 'pending' forever and
  // should not show badges or waste requests.
  const shouldPoll = isLiked || isBookmarked;

  useEffect(() => {
    if (!shouldPoll) return;
    if (!srcLoaded && !inView) return; // only poll when the card is active

    let cancelled = false;
    const videoId = video.video_id;

    async function loadTranscript() {
      try {
        const res = await fetchTranscript(videoId);
        if (cancelled) return;
        setTranscript((prev) => {
          // Detect transition into a terminal "ready" state for the toast.
          const wasPending =
            !prev ||
            prev.transcript_status === 'pending' ||
            prev.transcript_status === 'in_progress' ||
            prev.validation_status === 'pending' ||
            prev.validation_status === 'in_progress';
          const isReady =
            (res.transcript_status === 'completed' ||
              res.transcript_status === 'failed') &&
            (res.validation_status === 'completed' ||
              res.validation_status === 'failed' ||
              res.validation_status === 'skipped');
          if (wasPending && isReady) {
            const score = res.validation_accuracy_score;
            const pct =
              typeof score === 'number'
                ? `${Math.round(score * 100)}% verified`
                : null;
            if (res.transcript_status === 'failed') {
              showToast('Transcript failed to generate', 'error');
            } else if (pct) {
              showToast(`Transcript ready — ${pct}`, 'success');
            } else {
              showToast('Transcript ready', 'success');
            }
          }
          return res;
        });

        // Schedule continued polling while still pending.
        const stillPending =
          res.transcript_status === 'pending' ||
          res.transcript_status === 'in_progress' ||
          res.validation_status === 'pending' ||
          res.validation_status === 'in_progress';
        if (!stillPending && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        /* network errors are non-fatal for polling */
      }
    }

    void loadTranscript();

    // Only poll if we don't yet have a terminal transcript.
    const initialPending =
      video.transcript_status === 'pending' ||
      video.transcript_status === 'in_progress' ||
      video.validation_status === 'pending' ||
      video.validation_status === 'in_progress';
    if (initialPending) {
      pollRef.current = setInterval(loadTranscript, 10_000);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // Re-run when the card becomes active / loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, srcLoaded, video.video_id, shouldPoll]);

  // --- Actions --------------------------------------------------------------

  const handleLike = useCallback(async () => {
    const nextLiked = !isLiked;
    setIsLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    setLikeBump(true);
    window.setTimeout(() => setLikeBump(false), 450);
    try {
      await likeVideo(video.video_id, !nextLiked);
    } catch {
      // Revert on failure.
      setIsLiked(!nextLiked);
      setLikeCount((c) => c + (nextLiked ? -1 : 1));
      showToast('Failed to update like', 'error');
    }
  }, [isLiked, video.video_id, showToast]);

  const handleBookmark = useCallback(async () => {
    const next = !isBookmarked;
    setIsBookmarked(next);
    setBookmarkBump(true);
    window.setTimeout(() => setBookmarkBump(false), 450);
    try {
      await bookmarkVideo(video.video_id, !next);
    } catch {
      setIsBookmarked(!next);
      showToast('Failed to update bookmark', 'error');
    }
  }, [isBookmarked, video.video_id, showToast]);

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    try {
      await dismissVideo(video.video_id);
    } catch {
      showToast('Failed to dismiss video', 'error');
    }
    // Give the slide-away animation time, then notify the feed.
    window.setTimeout(() => onDismiss?.(video.video_id), 350);
  }, [video.video_id, onDismiss, showToast]);

  // --- Derived transcript / validation badge state -------------------------

  const tStatus = transcript?.transcript_status ?? video.transcript_status;
  const vStatus = transcript?.validation_status ?? video.validation_status;
  const score = transcript?.validation_accuracy_score ?? video.validation_accuracy_score;

  // Badges only make sense after the user has liked/bookmarked (which triggers
  // the pipeline). Don't show "Transcribing…" on videos that were never queued.
  const showBadges = isLiked || isBookmarked;

  const transcriptBadge = (() => {
    if (tStatus === 'pending' || tStatus === 'in_progress') {
      return { label: 'Transcribing…', icon: 'spinner', cls: 'bg-yellow-500/80 text-black' };
    }
    if (tStatus === 'failed') {
      return { label: 'Transcript failed', icon: '✕', cls: 'bg-red-600/80 text-white' };
    }
    if (tStatus === 'completed') {
      return { label: 'Transcript', icon: '✓', cls: 'bg-green-600/80 text-white' };
    }
    return null;
  })();

  const validationBadge = (() => {
    if (vStatus === 'pending' || vStatus === 'in_progress') {
      return { label: 'Validating…', cls: 'bg-yellow-500/80 text-black' };
    }
    if (vStatus === 'failed') {
      return { label: 'Validation failed', cls: 'bg-red-600/80 text-white' };
    }
    if (vStatus === 'skipped') {
      return { label: 'Not validated', cls: 'bg-gray-700/80 text-gray-200' };
    }
    if (vStatus === 'completed' && typeof score === 'number') {
      const pct = Math.round(score * 100);
      const cls = pct > 80 ? 'bg-green-600/80 text-white' : pct >= 50 ? 'bg-yellow-500/80 text-black' : 'bg-red-600/80 text-white';
      return { label: `${pct}% verified`, cls };
    }
    return null;
  })();

  const hashtags = (video.hashtags ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  const fmtCount = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K`
        : String(n);

  return (
    <section
      ref={cardRef}
      className={`relative h-dvh w-full snap-start snap-always overflow-hidden bg-black ${
        dismissing ? 'animate-slide-out' : ''
      }`}
    >
      {/* Video (lazy-loaded) */}
      {srcLoaded && (
        <video
          ref={videoRef}
          src={streamUrl(video.video_id)}
          poster={video.thumbnail_url ?? undefined}
          loop
          muted={muted}
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
          onClick={() => setMuted((m) => !m)}
        />
      )}

      {/* Gradient overlay for legibility */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />

      {/* Top badges (transcript + validation, #14) — only for liked/bookmarked */}
      {showBadges && (
        <div className="absolute left-3 top-3 z-20 flex flex-col gap-1.5">
          {transcriptBadge && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${transcriptBadge.cls}`}
            >
              {transcriptBadge.icon === 'spinner' ? (
                <span className="inline-block h-3 w-3 animate-spin-slow rounded-full border-[1.5px] border-current border-t-transparent" />
              ) : (
                <span>{transcriptBadge.icon}</span>
              )}
              {transcriptBadge.label}
            </span>
          )}
          {validationBadge && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${validationBadge.cls}`}
            >
              {validationBadge.label}
            </span>
          )}
        </div>
      )}

      {/* Bottom-left info overlay */}
      <div className="absolute bottom-20 left-3 z-20 max-w-[75%] space-y-1">
        <p className="text-sm font-bold">@{video.creator_handle}</p>
        {video.caption && (
          <p className="text-[13px] leading-snug text-gray-200">{video.caption}</p>
        )}
        {hashtags.length > 0 && (
          <p className="text-[13px] font-medium text-nyx-accent2">
            {hashtags.map((h) => `#${h}`).join(' ')}
          </p>
        )}
        <div className="flex items-center gap-3 pt-1 text-xs text-gray-300">
          <span>▶ {fmtCount(video.view_count)} views</span>
          <span>♥ {fmtCount(likeCount)}</span>
        </div>
      </div>

      {/* Right-side action rail */}
      <div className="absolute bottom-24 right-2 z-20 flex flex-col items-center gap-5">
        <ActionButton
          label={fmtCount(likeCount)}
          active={isLiked}
          bump={likeBump}
          onClick={handleLike}
        >
          <HeartIcon filled={isLiked} />
        </ActionButton>

        <ActionButton
          label="Save"
          active={isBookmarked}
          bump={bookmarkBump}
          onClick={handleBookmark}
        >
          <BookmarkIcon filled={isBookmarked} />
        </ActionButton>

        <ActionButton label="Dismiss" active={false} bump={false} onClick={handleDismiss}>
          <span className="text-2xl leading-none">✕</span>
        </ActionButton>
      </div>

      {/* Mute indicator */}
      {inView && (
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="absolute right-3 top-3 z-20 rounded-full bg-black/50 px-2.5 py-1 text-xs"
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      )}
    </section>
  );
}

/** Round action button with a label beneath. */
function ActionButton({
  children,
  label,
  active,
  bump,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  bump: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur transition active:scale-90 ${
          bump ? 'animate-pop' : ''
        } ${active ? 'text-nyx-accent' : 'text-white'}`}
      >
        {children}
      </span>
      <span className="text-[11px] font-medium text-white drop-shadow">
        {label}
      </span>
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M12 21s-7.5-4.6-10-9.3C.3 8 2.5 4.5 6 4.5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.5 0 5.7 3.5 4 7.2C19.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M6 3h12v18l-6-4-6 4V3z" />
    </svg>
  );
}
