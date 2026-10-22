import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  // Uploaded files live in the repo's data folder and are read from disk at runtime,
  // so make sure serverless deployments bundle them.
  outputFileTracingIncludes: {
    "/dashboard": ["./data/**/*"],
    "/admin": ["./data/**/*"],
    "/api/files/[name]": ["./data/**/*"],
  },
};

export default nextConfig;
