import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.PORT) || 4000,
  isProd: env.NODE_ENV === "production",
  corsOrigin: env.CORS_ORIGIN || "", // only needed if a browser calls the backend directly
  authSecret: env.AUTH_SECRET || "",
  cronSecret: env.CRON_SECRET || "",
  // Run the 15 and 30 minute timers inside this process. In production (Cloud Run scales to zero)
  // leave this off and let Cloud Scheduler call POST /api/jobs/<name>/run instead.
  enableScheduler: env.ENABLE_SCHEDULER === "true",
  // where uploaded files are kept (private; never served directly). On Cloud Run use a mounted bucket or a persistent disk.
  uploadDir: env.UPLOAD_DIR || "./data/uploads",
  callLogsApi: {
    baseUrl: (env.CALL_LOGS_API_URL || "https://call-logs-api-1010076791650.us-central1.run.app").replace(/\/+$/, ""),
    token: env.CALL_LOGS_API_TOKEN || "",
  },
};

if (config.authSecret.length < 16) {
  console.warn("AUTH_SECRET is missing or shorter than 16 characters; login will not work until it is set.");
}
