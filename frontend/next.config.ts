import type { NextConfig } from "next";

const backend = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // The frontend and backend are separate apps. The browser talks only to the frontend, which proxies
  // /api/* to the backend, so the session cookie stays same-origin (no CORS, no third-party cookies).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
