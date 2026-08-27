import type { NextConfig } from 'next';

/**
 * Browser calls go to the web origin under `/api/*` and are proxied to the API here. This mirrors
 * how the Caddy reverse proxy serves production (`/api/*` → api, `/*` → web —
 * docs/deployment/docker.md), so session cookies are first-party in every environment and
 * `apps/web/src/lib/api/client.ts` needs no cross-origin base URL for the browser. Server
 * Components still call `API_URL` directly (no self-proxy hop).
 *
 * If `API_URL` is not set (and no `NEXT_PUBLIC_API_URL` fallback), no rewrite is registered — a
 * genuinely cross-origin deployment sets `NEXT_PUBLIC_API_URL` + CORS instead.
 */
const apiOrigin = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    if (!apiOrigin) {
      return [];
    }
    return [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
