import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAdmin, requireAdminOrCron } from "../auth.js";
import { audit } from "../services/audit.js";
import { JOB_NAMES, runJob, type JobName } from "../services/jobs.js";

export const jobsRouter = Router();

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !isNaN(Date.parse(s)), "not a real date");
const Query = z.object({ from: Day.optional(), to: Day.optional(), wait: z.enum(["0", "1"]).optional() }).refine((q) => !q.from || !q.to || q.from <= q.to, "from must not be after to");

jobsRouter.get("/runs", requireAdmin, async (_req, res) => {
  res.json(await db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 }));
});

/**
 * Starts a job. An admin can re-run any job for a date range (?from=YYYY-MM-DD&to=YYYY-MM-DD).
 * A scheduler authenticates with `Authorization: Bearer $CRON_SECRET` and normally adds ?wait=1.
 * Without wait the call returns straight away and the run can be followed in /api/jobs/runs.
 */
jobsRouter.post("/:name/run", requireAdminOrCron, async (req, res) => {
  const name = req.params.name as JobName;
  if (!JOB_NAMES.includes(name)) return void res.status(404).json({ error: `Unknown job. Use one of: ${JOB_NAMES.join(", ")}` });
  const q = Query.safeParse(req.query);
  if (!q.success) return void res.status(400).json({ error: q.error.issues[0]?.message ?? "Invalid query" });

  const opts = { from: q.data.from, to: q.data.to, triggeredBy: req.session ? `admin:${req.session.email}` : "scheduler" };
  if (req.session) await audit(req.session.email, "job.run", name, { from: q.data.from ?? null, to: q.data.to ?? null });
  const work = runJob(name, opts);
  if (q.data.wait === "1") {
    const r = await work;
    return void res.status(r.started ? (r.status === "failed" ? 502 : 200) : 409).json(r);
  }
  work.catch(() => {});
  // give an immediate "already running" answer rather than a misleading "started"
  const early = await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), 300))]);
  if (early && !early.started) return void res.status(409).json(early);
  res.status(202).json({ started: true });
});
