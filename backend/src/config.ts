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
  // Sign-in. Google is the way in for staff; the email and password form is for local development and the first admin.
  publicUrl: (env.PUBLIC_URL || "http://localhost:3000").replace(/\/+$/, ""), // the website's address: Google sends people back here
  google: { clientId: env.GOOGLE_CLIENT_ID || "", clientSecret: env.GOOGLE_CLIENT_SECRET || "" },
  allowedDomain: (env.ALLOWED_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, ""),
  adminEmails: (env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
  callLogsApi: {
    baseUrl: (env.CALL_LOGS_API_URL || "https://call-logs-api-1010076791650.us-central1.run.app").replace(/\/+$/, ""),
    token: env.CALL_LOGS_API_TOKEN || "",
  },
};

export const googleEnabled = () => !!(config.google.clientId && config.google.clientSecret && config.allowedDomain);
/** Password sign-in stays on for development; in production it is off as soon as Google is set up, unless ALLOW_PASSWORD_LOGIN=true. */
export const passwordLoginEnabled = () => (env.ALLOW_PASSWORD_LOGIN ? env.ALLOW_PASSWORD_LOGIN === "true" : !(config.isProd && googleEnabled()));

if (config.authSecret.length < 16) {
  console.warn("AUTH_SECRET is missing or shorter than 16 characters; login will not work until it is set.");
}
