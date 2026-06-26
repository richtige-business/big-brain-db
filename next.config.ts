import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allow the dev server's client JS / HMR to load when the app is opened via
  // the LAN IP (e.g. http://192.168.2.216:3000) instead of localhost.
  // Without this, Next.js 16 blocks /_next dev resources cross-origin and the
  // page renders but never hydrates (nothing is clickable or scrollable).
  allowedDevOrigins: ['192.168.2.216'],
};

export default nextConfig;
