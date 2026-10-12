import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.replit.dev'],
};
export default nextConfig;
