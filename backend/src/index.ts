import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config.js";
import { db } from "./db.js";
import { requireUser } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { statsRouter } from "./routes/stats.js";
import { recordsRouter } from "./routes/records.js";
import { filesRouter } from "./routes/files.js";

const app = express();
app.set("trust proxy", 1); // behind the frontend proxy / a load balancer
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(","), credentials: true }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const api = express.Router();
api.use("/auth", authRouter);
api.use("/stats", requireUser, statsRouter);
api.use(recordsRouter); // /calls, /emails (auth applied per route)
api.use(filesRouter); // /files, /sheets, /admin/*, /sync/* (each route enforces its own auth)
app.use("/api", api);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(config.port, () => console.log(`Backend listening on :${config.port}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => server.close(() => db.$disconnect().finally(() => process.exit(0))));
}
