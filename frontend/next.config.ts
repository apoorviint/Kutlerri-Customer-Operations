import type { NextConfig } from "next";

const backend = (process.env.BACKEND_URL || "http://localhost:4000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone", // a small self-contained server for the Docker image
  poweredByHeader: false,
  // The admin console uploads spreadsheets (prospect databases run to 15 MB and more) through this proxy; the default cap is 10 MB.
  experimental: { middlewareClientMaxBodySize: "100mb" },
  // The frontend and backend are separate apps. The browser talks only to the frontend, which proxies
  // /api/* to the backend, so the session cookie stays same-origin (no CORS, no third-party cookies).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
