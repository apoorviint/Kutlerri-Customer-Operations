import { Router } from "express";
import { db } from "../db.js";

export const healthRouter = Router();

/** Is the service up? (Cloud Run / load balancer check.) */
healthRouter.get("/", (_req, res) => res.json({ status: "ok" }));

/** Can it reach the database? */
healthRouter.get("/ready", async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "database unreachable" });
  }
});

/**
 * For an uptime check that should alert when data stops flowing: 503 when the last successful calls sync is older than
 * two hours, or the latest sync run failed. Reveals nothing but a yes or no.
 */
healthRouter.get("/feeds", async (_req, res) => {
  const [ok, last] = await Promise.all([
    db.syncRun.findFirst({ where: { source: "calls", status: { in: ["ok", "warning"] } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    db.syncRun.findFirst({ where: { source: "calls" }, orderBy: { startedAt: "desc" }, select: { status: true } }),
  ]);
  const ageH = ok?.finishedAt ? (Date.now() - ok.finishedAt.getTime()) / 3_600_000 : Infinity;
  const healthy = ageH <= 2 && last?.status !== "failed";
  res.status(healthy ? 200 : 503).json({ status: healthy ? "fresh" : "stale" });
});
