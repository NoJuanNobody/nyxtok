/** @type {import('next').NextConfig} */
const API_TARGET =
  process.env.NYXTOK_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* requests to the backend Fastify server so the browser can use
  // same-origin relative URLs (and Bearer tokens are attached by api.ts).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_TARGET}/api/:path*`,
      },
    ];
  },
  transpilePackages: ['@nyxtok/shared'],
};

module.exports = nextConfig;
