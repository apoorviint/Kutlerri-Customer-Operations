import { Router } from "express";
import multer from "multer";
import { requireAdmin, requireAdminOrCron, requireUser } from "../auth.js";
import { builtFilePath, listBuiltFiles, loadWorkbooks } from "../services/files.js";
import { commitFile, deleteRepoFile, listRepoFiles, safeName } from "../services/github.js";
import { isSyncing, lastSyncRun, startSync } from "../services/sync.js";

export const filesRouter = Router();

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(xlsx|xls|csv|pdf|png|jpe?g|txt|json|docx?)$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// ---- readable by any signed-in user: what is in the CURRENT deployed build ----

filesRouter.get("/files", requireUser, async (_req, res) => {
  res.json(await listBuiltFiles());
});

filesRouter.get("/files/:name", requireUser, async (req, res) => {
  const p = await builtFilePath(String(req.params.name));
  if (!p) return void res.status(404).json({ error: "Not found" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.download(p, String(req.params.name));
});

filesRouter.get("/sheets", requireUser, async (_req, res) => {
  res.json(await loadWorkbooks());
});

// ---- admin: push to GitHub, which triggers the host's rebuild ----

filesRouter.get("/admin/files", requireAdmin, async (_req, res) => {
  try {
    const [repo, built] = await Promise.all([listRepoFiles(), listBuiltFiles()]);
    const live = new Map(built.map((f) => [f.name, f.size]));
    // "live" = present in the running build with the same size; same-size edits can't be told apart
    res.json(repo.map((f) => ({ ...f, live: live.get(f.name) === f.size })));
  } catch (e) {
    res.status(502).json({ error: msg(e, "Could not reach GitHub") });
  }
});

filesRouter.post("/admin/upload", requireAdmin, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      const tooBig = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
      return void res.status(400).json({ error: tooBig ? "File must be 10 MB or smaller" : "Upload failed" });
    }
    const file = req.file;
    if (!file || file.size === 0) return void res.status(400).json({ error: "No file" });
    // multer decodes names as latin1; restore UTF-8 before validating
    const original = Buffer.from(file.originalname, "latin1").toString("utf8");
    if (!ALLOWED.test(original)) return void res.status(400).json({ error: "File type not allowed" });
    try {
      const out = await commitFile(original, file.buffer, `Upload ${safeName(original)} via dashboard (${req.session!.email})`);
      res.json(out);
    } catch (e) {
      res.status(502).json({ error: msg(e, "Upload failed") });
    }
  });
});

filesRouter.delete("/admin/files/:name", requireAdmin, async (req, res) => {
  try {
    await deleteRepoFile(String(req.params.name), `Delete ${safeName(String(req.params.name))} via dashboard (${req.session!.email})`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: msg(e, "Delete failed") });
  }
});

// ---- sync from the call-logs API ----

filesRouter.get("/sync/status", requireAdmin, async (_req, res) => {
  res.json({ running: isSyncing(), last: await lastSyncRun() });
});

// Admin UI: returns 202 immediately and is polled via /sync/status.
// Scheduler: add ?wait=1 to hold the request open until the sync finishes.
filesRouter.post("/sync", requireAdminOrCron, async (req, res) => {
  const run = startSync();
  if (req.query.wait === "1") {
    const result = await run;
    return void res.status(result.ok ? 200 : 502).json(result);
  }
  run.catch(() => {});
  res.status(202).json({ started: true });
});
