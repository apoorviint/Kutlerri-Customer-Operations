import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { db } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { statusRouter } from "./routes/status.js";
import { jobsRouter } from "./routes/jobs.js";
import { assignmentsRouter } from "./routes/assignments.js";
import { adminRouter } from "./routes/admin.js";
import { uploadsRouter } from "./routes/uploads.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ensureReferenceData } from "./services/referenceData.js";
import { cleanUpAfterCrash, startScheduler } from "./services/jobs.js";
import { sweepStaged } from "./services/storage.js";
import { rateLimit, requestLog, securityHeaders } from "./security.js";
import { healthRouter } from "./routes/health.js";

const app = express();
app.set("trust proxy", 1); // behind the frontend proxy / a load balancer
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(requestLog);
// a pasted sheet can be large; every other endpoint takes small bodies only
app.use("/api/admin/assignments", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(","), credentials: true }));

app.use("/health", healthRouter); // no data, no sign-in: for load balancers and uptime checks

const api = express.Router();
// generous for people (a dashboard makes a dozen calls per screen), tight for the scheduler-free paths
api.use(rateLimit(900, 60_000, (req) => !!config.cronSecret && req.headers.authorization === `Bearer ${config.cronSecret}`));
const uploadLimit = rateLimit(120, 60 * 60_000); // only uploads and confirmations count (a check and a save are two), not the progress polling
api.use("/admin/files", (req, res, next) => (req.method === "POST" ? uploadLimit(req, res, next) : next()));
api.use("/auth", authRouter);
api.use("/status", statusRouter);
api.use("/jobs", jobsRouter);
api.use("/admin/assignments", assignmentsRouter);
api.use("/admin/files", uploadsRouter);
api.use("/admin", adminRouter);
api.use(dashboardRouter); // the dashboards' data; mounted last because it asks for a signed-in user on everything that reaches it
app.use("/api", api);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await ensureReferenceData();
  await cleanUpAfterCrash();
  void sweepStaged();
  const server = app.listen(config.port, () => console.log(`Backend listening on :${config.port}`));
  const stopScheduler = startScheduler();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      stopScheduler();
      server.close(() => db.$disconnect().finally(() => process.exit(0)));
    });
  }
}

main().catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
