import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { db } from "../db.js";
import { requireAdmin } from "../auth.js";
import { parseAssignmentSheet } from "../rules/assignmentSheet.js";
import { todayIn } from "../rules/time.js";
import { AssignmentValidationError, commitAssignments, previewAssignments } from "../services/assignments.js";
import { audit } from "../services/audit.js";
import { BillingValidationError, commitBilling, previewBilling, rollbackBilling } from "../services/billing.js";
import { fileKind, pickSheet, readSheets } from "../services/fileGrid.js";
import { runJob } from "../services/jobs.js";
import { processBatch, rollbackBatch, startBatch } from "../services/prospects.js";
import { loadSettings } from "../services/settings.js";
import { keep, newStagedId, stagedPath, stagingDir } from "../services/storage.js";
import { looksLike } from "../security.js";
import { open as openFile } from "node:fs/promises";

/**
 * File uploads for the admin console. Two steps for the sheets (assignments, billing): upload the file to get a preview,
 * then commit by the staged id. A prospect database is read in the background right after it is uploaded.
 */
export const uploadsRouter = Router();
uploadsRouter.use(requireAdmin);

const MAX_MB = 60;
const upload = multer({
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { stagingDir().then((d) => cb(null, d), (e) => cb(e, "")); },
    filename: (_req, file, cb) => cb(null, `${newStagedId()}${file.originalname.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]?.toLowerCase() ?? ""}`),
  }),
});

/** Runs multer and turns its errors (file too large, wrong field) into a plain 400. */
const receive = (req: Request, res: Response) =>
  new Promise<Express.Multer.File | null>((resolve) =>
    upload.single("file")(req, res, (err) => {
      if (err) { res.status(400).json({ error: err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE" ? `The file is larger than ${MAX_MB} MB.` : "The upload could not be read." }); return resolve(null); }
      if (!req.file) { res.status(400).json({ error: "Choose a file to upload (field name: file)." }); return resolve(null); }
      const file = req.file;
      void (async () => {
        try {
          const kind = fileKind(file.originalname);
          const fh = await openFile(file.path, "r");
          const head = Buffer.alloc(8192);
          const { bytesRead } = await fh.read(head, 0, 8192, 0);
          await fh.close();
          if (!looksLike(kind, head.subarray(0, bytesRead))) throw new Error(`This file is not really a ${kind === "xlsx" ? ".xlsx workbook" : "text .csv file"}. Check that it was saved in that format.`);
          resolve(file);
        } catch (e) {
          await rm(file.path, { force: true });
          res.status(400).json({ error: (e as Error).message });
          resolve(null);
        }
      })();
    }),
  );

const hashFile = (path: string) => new Promise<string>((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(path).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});
const stagedIdOf = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");
const Commit = z.object({ stagedId: z.string(), fileName: z.string().max(300).optional(), sheet: z.string().optional(), force: z.boolean().optional() });

// ───────────── who dialed for whom ─────────────

async function assignmentInput(path: string, fileName: string, sheet?: string) {
  const sheets = await readSheets(path, fileName);
  const s = pickSheet(sheets, sheet);
  const settings = await loadSettings();
  const parsed = parseAssignmentSheet(s.rows, { anchor: todayIn(settings.shiftZone) });
  return { sheets: sheets.map((x) => x.name), used: s.name, parsed };
}

uploadsRouter.post("/assignments/preview", async (req, res) => {
  const file = await receive(req, res);
  if (!file) return;
  try {
    const { sheets, used, parsed } = await assignmentInput(file.path, file.originalname, typeof req.body?.sheet === "string" ? req.body.sheet : undefined);
    const { resolved: _r, ...preview } = await previewAssignments({ rows: parsed.rows, errors: parsed.errors, warnings: parsed.warnings, layout: parsed.layout });
    res.json({ stagedId: stagedIdOf(file.path), fileName: file.originalname, sheets, sheet: used, ...preview, columns: parsed.columns });
  } catch (e) {
    await rm(file.path, { force: true });
    res.status(422).json({ error: e instanceof Error ? e.message : "Could not read the file" });
  }
});

uploadsRouter.post("/assignments/commit", async (req, res) => {
  const b = Commit.safeParse(req.body);
  if (!b.success) return void res.status(400).json({ error: "Send { stagedId }" });
  const path = await stagedPath(b.data.stagedId);
  if (!path) return void res.status(404).json({ error: "That upload has expired. Choose the file again." });
  const fileName = b.data.fileName ?? "assignments";
  try {
    const { parsed } = await assignmentInput(path, path, b.data.sheet);
    const hash = await hashFile(path);
    const r = await commitAssignments(
      { rows: parsed.rows, errors: parsed.errors, warnings: parsed.warnings, layout: parsed.layout },
      { source: "upload", fileName, fileHash: hash, uploadedBy: req.session!.email, force: b.data.force },
    );
    if (!r.committed) return void res.json({ committed: false, message: "Nothing would change, so nothing was saved.", preview: r.preview });
    const key = await keep("assignments", r.uploadId, fileName, path);
    await db.assignmentUpload.update({ where: { id: r.uploadId }, data: { fileKey: key } });
    await audit(req.session!.email, "assignments.upload", fileName, { uploadId: r.uploadId, rows: r.preview.rows, totals: r.preview.totals });
    void runJob("attribute-calls", { from: r.range.from, to: r.range.to ?? undefined, triggeredBy: `assignments:${req.session!.email}` });
    res.json({ committed: true, uploadId: r.uploadId, preview: r.preview, recalculating: r.range });
  } catch (e) {
    if (e instanceof AssignmentValidationError) return void res.status(422).json({ error: "The sheet has problems; nothing was saved.", problems: e.errors });
    throw e;
  }
});

// ───────────── billing ─────────────

async function billingGrid(path: string, fileName: string, sheet?: string) {
  const sheets = await readSheets(path, fileName);
  const s = pickSheet(sheets, sheet);
  return { sheets: sheets.map((x) => x.name), used: s.name, grid: s.rows };
}

uploadsRouter.post("/billing/preview", async (req, res) => {
  const file = await receive(req, res);
  if (!file) return;
  try {
    const { sheets, used, grid } = await billingGrid(file.path, file.originalname, typeof req.body?.sheet === "string" ? req.body.sheet : undefined);
    const { values: _v, ...preview } = await previewBilling(grid);
    res.json({ stagedId: stagedIdOf(file.path), fileName: file.originalname, sheets, sheet: used, ...preview });
  } catch (e) {
    await rm(file.path, { force: true });
    res.status(422).json({ error: e instanceof Error ? e.message : "Could not read the file" });
  }
});

uploadsRouter.post("/billing/commit", async (req, res) => {
  const b = Commit.safeParse(req.body);
  if (!b.success) return void res.status(400).json({ error: "Send { stagedId }" });
  const path = await stagedPath(b.data.stagedId);
  if (!path) return void res.status(404).json({ error: "That upload has expired. Choose the file again." });
  const fileName = b.data.fileName ?? path;
  try {
    const { grid } = await billingGrid(path, path, b.data.sheet);
    const r = await commitBilling(grid, { fileName: b.data.fileName, fileHash: await hashFile(path), uploadedBy: req.session!.email });
    if (!r.committed) return void res.json({ committed: false, message: "Nothing would change, so nothing was saved.", preview: r.preview });
    const key = await keep("billing", r.uploadId, fileName.split(/[\\/]/).pop()!, path);
    await db.billingUpload.update({ where: { id: r.uploadId }, data: { fileKey: key } });
    res.json({ committed: true, uploadId: r.uploadId, preview: r.preview });
  } catch (e) {
    if (e instanceof BillingValidationError) return void res.status(422).json({ error: "The sheet has problems; nothing was saved.", problems: e.errors });
    throw e;
  }
});

uploadsRouter.get("/billing/uploads", async (_req, res) => {
  res.json(await db.billingUpload.findMany({ orderBy: { uploadedAt: "desc" }, take: 50 }));
});

uploadsRouter.post("/billing/uploads/:id/rollback", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return void res.status(400).json({ error: "Invalid id" });
  try {
    await rollbackBilling(id, req.session!.email);
    res.json({ rolledBack: true });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Could not roll back" });
  }
});

uploadsRouter.get("/billing/summary", async (_req, res) => {
  const [orders, last] = await Promise.all([db.billingOrder.count(), db.billingUpload.findFirst({ where: { status: "committed" }, orderBy: { uploadedAt: "desc" } })]);
  res.json({ orders, lastUpload: last ? { id: last.id, at: last.uploadedAt, by: last.uploadedBy, fileName: last.fileName } : null });
});

// ───────────── prospect databases ─────────────

const ProspectForm = z.object({ clientId: z.coerce.number().int().positive(), replace: z.enum(["true", "false"]).optional(), confirmReplace: z.enum(["true", "false"]).optional() });

uploadsRouter.post("/prospects/upload", async (req, res) => {
  const file = await receive(req, res);
  if (!file) return;
  const f = ProspectForm.safeParse(req.body);
  const client = f.success ? await db.client.findFirst({ where: { id: f.data.clientId, kind: "CUSTOMER" } }) : null;
  if (!f.success || !client) { await rm(file.path, { force: true }); return void res.status(400).json({ error: "Choose which client this database belongs to." }); }
  const replace = f.data.replace === "true";
  if (replace && f.data.confirmReplace !== "true") {
    await rm(file.path, { force: true });
    return void res.status(400).json({ error: `Replacing removes every database currently loaded for ${client.name}. Confirm to continue.` });
  }
  const batchId = await startBatch({ clientId: client.id, filePath: file.path, fileName: file.originalname, fileHash: await hashFile(file.path), replace, uploadedBy: req.session!.email });
  void processBatch(batchId); // reads the file in the background; follow it with GET /prospects/batches/:id
  res.status(202).json({ batchId });
});

uploadsRouter.get("/prospects/batches", async (req, res) => {
  const clientId = Number(req.query.clientId);
  const batches = await db.prospectBatch.findMany({ where: Number.isInteger(clientId) && clientId > 0 ? { clientId } : {}, orderBy: { uploadedAt: "desc" }, take: 100 });
  const clients = new Map((await db.client.findMany()).map((c) => [c.id, c.name]));
  res.json(batches.map((b) => ({ ...b, client: clients.get(b.clientId) ?? "" })));
});

uploadsRouter.get("/prospects/batches/:id", async (req, res) => {
  const b = await db.prospectBatch.findUnique({ where: { id: Number(req.params.id) || 0 } });
  if (!b) return void res.status(404).json({ error: "No such upload" });
  res.json(b);
});

uploadsRouter.get("/prospects/summary", async (_req, res) => {
  const rows = await db.$queryRaw<{ client_id: number; phones: number }[]>`SELECT client_id, count(*)::int AS phones FROM phone_matches GROUP BY client_id`;
  res.json(Object.fromEntries(rows.map((r) => [r.client_id, r.phones])));
});

uploadsRouter.post("/prospects/batches/:id/rollback", async (req, res) => {
  try {
    res.json({ rolledBack: true, ...(await rollbackBatch(Number(req.params.id) || 0, req.session!.email)) });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : "Could not roll back" });
  }
});
