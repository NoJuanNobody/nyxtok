'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom navigation bar: Feed | Library | Search.
 *
 * Fixed to the bottom of the viewport; the feed route hides it (the feed is
 * immersive full-screen), so this component renders null when active.
 */
const TABS = [
  { href: '/', label: 'Feed', icon: '📺' },
  { href: '/library', label: 'Library', icon: '📚' },
  { href: '/search', label: 'Search', icon: '🔍' },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  // Hide on the immersive feed route.
  if (pathname === '/') return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-800 bg-gray-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition ${
                active ? 'text-nyx-accent2' : 'text-gray-500'
              }`}
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
