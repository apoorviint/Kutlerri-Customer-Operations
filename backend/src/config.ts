import "dotenv/config";
import path from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT) || 4000,
  isProd: env.NODE_ENV === "production",
  corsOrigin: env.CORS_ORIGIN || "", // only needed if the browser calls the backend directly
  authSecret: env.AUTH_SECRET || "",
  cronSecret: env.CRON_SECRET || "",
  callLogsApi: {
    baseUrl: (env.CALL_LOGS_API_URL || "https://call-logs-api-1010076791650.us-central1.run.app").replace(/\/+$/, ""),
    token: env.CALL_LOGS_API_TOKEN || "",
  },
  github: {
    token: env.GITHUB_TOKEN || "",
    owner: env.GITHUB_OWNER || "",
    repo: env.GITHUB_REPO || "",
    branch: env.GITHUB_BRANCH || "main",
    // path of the data folder inside the repo
    dir: (env.GITHUB_UPLOAD_DIR || "backend/data").replace(/^\/+|\/+$/g, ""),
  },
  // local folder (as shipped in the deployed build) the dashboard reads spreadsheets from
  dataDir: path.resolve(env.DATA_DIR || "data"),
};

if (config.authSecret.length < 16) {
  console.warn("AUTH_SECRET is missing or shorter than 16 characters; login will not work until it is set.");
}
