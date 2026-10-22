import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";

/**
 * Private storage for uploaded files. Nothing here is ever served directly: files are read back only by admin-only
 * endpoints. This version keeps them in a folder (UPLOAD_DIR); a cloud bucket can replace it by implementing the
 * same few functions (Phase 5 deployment).
 */
const root = () => resolve(config.uploadDir);

function safe(key: string) {
  const p = resolve(root(), key);
  if (p !== root() && !p.startsWith(root() + sep)) throw new Error("Invalid storage key");
  return p;
}

const clean = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

/** Where multer first puts an incoming file, until an admin confirms it. */
export async function stagingDir() {
  const d = join(root(), "staged");
  await mkdir(d, { recursive: true });
  return d;
}

export const newStagedId = () => randomBytes(12).toString("hex");

export async function stagedPath(id: string): Promise<string | null> {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const dir = await stagingDir();
  const hit = (await readdir(dir)).find((f) => f.startsWith(id));
  return hit ? join(dir, hit) : null;
}

/** Moves a staged or temporary file into permanent storage and returns its key. */
export async function keep(kind: "assignments" | "billing" | "prospects", id: number, fileName: string, from: string): Promise<string> {
  const key = `${kind}/${id}-${clean(fileName)}`;
  const to = safe(key);
  await mkdir(dirname(to), { recursive: true });
  try { await rename(from, to); } catch { await copyFile(from, to); await rm(from, { force: true }); }
  return key;
}

export const openStored = (key: string) => createReadStream(safe(key));
export const storedPath = (key: string) => safe(key);

/** Removes staged files nobody confirmed within a day. */
export async function sweepStaged(maxAgeMs = 24 * 3600_000) {
  try {
    const dir = await stagingDir();
    for (const f of await readdir(dir)) {
      const p = join(dir, f);
      if (Date.now() - (await stat(p)).mtimeMs > maxAgeMs) await rm(p, { force: true });
    }
  } catch { /* nothing to sweep */ }
}
