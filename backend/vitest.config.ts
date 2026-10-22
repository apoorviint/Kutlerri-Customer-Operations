import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration tests need a real Postgres (set TEST_DATABASE_URL); without it they are skipped.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused",
      AUTH_SECRET: "test-secret-0123456789abcdef",
    },
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
