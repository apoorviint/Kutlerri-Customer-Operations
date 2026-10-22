import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { db } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { statusRouter } from "./routes/status.js";
import { jobsRouter } from "./routes/jobs.js";
import { assignmentsRouter } from "./routes/assignments.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { ensureReferenceData } from "./services/referenceData.js";
import { cleanUpAfterCrash, startScheduler } from "./services/jobs.js";

const app = express();
app.set("trust proxy", 1); // behind the frontend proxy / a load balancer
app.disable("x-powered-by");
// a pasted sheet can be large; every other endpoint takes small bodies only
app.use("/api/admin/assignments", express.json({ limit: "10mb" }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(","), credentials: true }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const api = express.Router();
api.use("/auth", authRouter);
api.use("/status", statusRouter);
api.use("/jobs", jobsRouter);
api.use("/admin/assignments", assignmentsRouter);
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
