import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAdmin } from "../auth.js";
import { parseAssignmentSheet } from "../rules/assignmentSheet.js";
import { todayIn } from "../rules/time.js";
import { AssignmentValidationError, commitAssignments, fileHash, previewAssignments, rollbackUpload } from "../services/assignments.js";
import { audit } from "../services/audit.js";
import { runJob } from "../services/jobs.js";
import { loadSettings } from "../services/settings.js";

/**
 * The who-dialed-for-whom sheet. These endpoints take the sheet as rows of cells (`grid`); turning an uploaded
 * xlsx or csv file into those rows, and the upload screen, come with the admin console (Phase 4).
 */
export const assignmentsRouter = Router();
assignmentsRouter.use(requireAdmin); // the body is read in index.ts, with a larger size limit

const Body = z.object({
  grid: z.array(z.array(z.unknown())).min(1).max(5000),
  fileName: z.string().max(300).optional(),
  force: z.boolean().optional(),
});

async function read(grid: unknown[][]) {
  const settings = await loadSettings();
  return parseAssignmentSheet(grid, { anchor: todayIn(settings.shiftZone) });
}

/** What would change, before anything is saved: rows added, replaced and removed per period, plus any problems. */
assignmentsRouter.post("/preview", async (req, res) => {
  const b = Body.safeParse(req.body);
  if (!b.success) return void res.status(400).json({ error: "Send the sheet as { grid: [[cell, …], …] }" });
  const parsed = await read(b.data.grid);
  const { resolved: _resolved, ...preview } = await previewAssignments({ rows: parsed.rows, errors: parsed.errors, warnings: parsed.warnings, layout: parsed.layout });
  res.json({ ...preview, columns: parsed.columns });
});

assignmentsRouter.post("/commit", async (req, res) => {
  const b = Body.safeParse(req.body);
  if (!b.success) return void res.status(400).json({ error: "Send the sheet as { grid: [[cell, …], …] }" });
  const parsed = await read(b.data.grid);
  try {
    const r = await commitAssignments(
      { rows: parsed.rows, errors: parsed.errors, warnings: parsed.warnings, layout: parsed.layout },
      { source: "upload", fileName: b.data.fileName, fileHash: fileHash(JSON.stringify(b.data.grid)), uploadedBy: req.session!.email, force: b.data.force },
    );
    if (!r.committed) return void res.json({ committed: false, message: "Nothing would change, so nothing was saved.", preview: r.preview });
    // recalculate who each call belongs to for the affected days, in the background
    void runJob("attribute-calls", { from: r.range.from, to: r.range.to ?? undefined, triggeredBy: `assignments:${req.session!.email}` });
    res.json({ committed: true, uploadId: r.uploadId, preview: r.preview, recalculating: r.range });
  } catch (e) {
    if (e instanceof AssignmentValidationError) return void res.status(422).json({ error: "The sheet has problems; nothing was saved.", problems: e.errors });
    throw e;
  }
});

assignmentsRouter.get("/uploads", async (_req, res) => {
  res.json(await db.assignmentUpload.findMany({ orderBy: { uploadedAt: "desc" }, take: 50, include: { _count: { select: { assignments: true } } } }));
});

assignmentsRouter.post("/uploads/:id/rollback", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Invalid id" });
  try {
    const { range } = await rollbackUpload(id, req.session!.email);
    await audit(req.session!.email, "assignments.rollback", `upload #${id}`, { range });
    if (range) void runJob("attribute-calls", { from: range.from, to: range.to ?? undefined, triggeredBy: `rollback:${req.session!.email}` });
    res.json({ rolledBack: true, recalculating: range });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Could not roll back" });
  }
});
