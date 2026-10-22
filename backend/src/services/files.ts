import { promises as fs } from "node:fs";
import path from "node:path";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { config } from "../config.js";
import { safeName } from "./github.js";

export type Sheet = { name: string; header: string[]; rows: string[][]; totalRows: number };
export type Workbook = { file: string; sheets: Sheet[]; error?: string };

const PREVIEW_ROWS = 100;

/** Files that shipped with the deployed build (the data folder). */
export async function listBuiltFiles() {
  try {
    const out = [];
    for (const name of await fs.readdir(config.dataDir)) {
      if (name === ".gitkeep") continue;
      const st = await fs.stat(path.join(config.dataDir, name));
      if (st.isFile()) out.push({ name, size: st.size });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function builtFilePath(name: string) {
  if (safeName(name) !== name) return null;
  const p = path.join(config.dataDir, name);
  try {
    return (await fs.stat(p)).isFile() ? p : null;
  } catch {
    return null;
  }
}

const cell = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Parses every .xlsx in the data folder. Never throws; a bad file is reported in `error`. */
export async function loadWorkbooks(): Promise<Workbook[]> {
  const files = (await listBuiltFiles()).filter((f) => /\.xlsx$/i.test(f.name));
  const out: Workbook[] = [];
  for (const { name: file } of files) {
    try {
      const buf = await fs.readFile(path.join(config.dataDir, file));
      const sheets: Sheet[] = [];
      for (const name of await readSheetNames(buf)) {
        const [head = [], ...body] = await readXlsxFile(buf, { sheet: name });
        sheets.push({
          name,
          header: head.map(cell),
          rows: body.slice(0, PREVIEW_ROWS).map((r) => r.map(cell)),
          totalRows: body.length,
        });
      }
      out.push({ file, sheets });
    } catch (e) {
      out.push({ file, sheets: [], error: e instanceof Error ? e.message : "Could not read file" });
    }
  }
  return out;
}
