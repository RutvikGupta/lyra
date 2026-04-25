import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Spotify OAuth requires 127.0.0.1 (not localhost) since Nov 2025.
  // Whitelist it so the Next.js 16 dev server allows HMR from that origin.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
