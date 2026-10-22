import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitUpload, githubEnabled, uploadPath } from "./githubUploads";

/**
 * The admin uploads pass through these route handlers on their way to the backend. The backend reads the file and
 * saves the rows; once it says the upload is saved, the original file is committed to GitHub from here.
 * A sheet is checked first and saved later (by its stagedId), so the file waits in a temporary folder in between.
 */
const backend = () => (process.env.BACKEND_URL || "http://localhost:8080").replace(/\/+$/, "");
const staging = join(tmpdir(), "kutlerri-uploads");
const DAY_MS = 24 * 3600_000;

/** Sends the request on to the backend exactly as it came (cookie, client address, body). */
export async function forward(req: Request, path: string, body: ArrayBuffer | string, contentType: string | null) {
  const headers: Record<string, string> = {};
  for (const h of ["cookie", "authorization", "x-forwarded-for", "user-agent"]) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  if (contentType) headers["content-type"] = contentType;
  return fetch(`${backend()}${path}`, { method: "POST", headers, body, signal: AbortSignal.timeout(900_000) });
}

/** The backend's answer, passed back to the browser unchanged (plus an optional warning). */
export function reply(status: number, body: unknown) {
  const res = Response.json(body, { status, headers: { "cache-control": "no-store" } });
  return res;
}

/** The uploaded file from a multipart body (the field is "file"). */
export async function fileFrom(body: ArrayBuffer, contentType: string | null): Promise<File | null> {
  try {
    const form = await new Request("http://local/", { method: "POST", body, headers: contentType ? { "content-type": contentType } : {} }).formData();
    const f = form.get("file");
    return f instanceof File ? f : null;
  } catch {
    return null;
  }
}

const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{24}$/.test(id);

export async function stash(stagedId: unknown, file: File) {
  if (!validId(stagedId)) return;
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, stagedId), new Uint8Array(await file.arrayBuffer()));
  void sweep();
}

export async function unstash(stagedId: unknown): Promise<Uint8Array | null> {
  if (!validId(stagedId)) return null;
  try { return new Uint8Array(await readFile(join(staging, stagedId))); } catch { return null; }
}

export const drop = (stagedId: unknown) => (validId(stagedId) ? rm(join(staging, stagedId), { force: true }) : Promise.resolve());

/** Removes files nobody saved within a day. */
async function sweep() {
  try {
    for (const f of await readdir(staging)) {
      const p = join(staging, f);
      if (Date.now() - (await stat(p)).mtimeMs > DAY_MS) await rm(p, { force: true });
    }
  } catch { /* nothing to sweep */ }
}

/** Commits the file to GitHub. A failure does not undo the saved rows; it comes back as a warning. */
export async function keepInGitHub(kind: "assignments" | "billing" | "prospects", id: number, fileName: string, content: Uint8Array | null, by: string) {
  if (!githubEnabled()) return "GITHUB_TOKEN / GITHUB_UPLOADS_REPO are not set on the website, so the original file was not kept.";
  if (!content) return "Saved, but the original file was no longer available to keep in GitHub.";
  try {
    await commitUpload(uploadPath(kind, id, fileName), content, `Upload ${kind} #${id}: ${fileName} (by ${by})`);
    return null;
  } catch (e) {
    console.error("[uploads] GitHub:", e instanceof Error ? e.message : e);
    return `Saved, but the original file could not be kept in GitHub: ${e instanceof Error ? e.message : "unknown error"}`;
  }
}

/** Who is uploading (for the commit message), from the backend. */
export async function whoAmI(req: Request): Promise<string> {
  try {
    const r = await fetch(`${backend()}/api/auth/me`, { headers: { cookie: req.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(15_000) });
    return r.ok ? ((await r.json()) as { email: string }).email : "unknown";
  } catch { return "unknown"; }
}
