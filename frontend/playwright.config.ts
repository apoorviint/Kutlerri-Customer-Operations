import { defineConfig } from "@playwright/test";

// These tests drive the real dashboard in Chrome. Start the backend (with data) and the frontend first:
//   backend:  npm run dev        (http://localhost:4000)
//   frontend: npm run dev        (http://localhost:3000)
// then: E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", channel: "chrome", headless: true, viewport: { width: 1400, height: 1000 } },
});
