import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nyxtok',
  description: 'AI-curated vertical video learning feed',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#030712',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Default to dark mode: the `dark` class on <html> enables Tailwind's
  // class-based dark variants.
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-50 min-h-dvh antialiased">
        {children}
      </body>
    </html>
  );
}
