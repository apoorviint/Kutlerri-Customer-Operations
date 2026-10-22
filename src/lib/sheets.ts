import { promises as fs } from "fs";
import path from "path";
import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { dataDir } from "./github";

export type Sheet = { name: string; header: string[]; rows: string[][]; totalRows: number };
export type Workbook = { file: string; sheets: Sheet[]; error?: string };

const PREVIEW_ROWS = 50;

const cell = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** Parses every .xlsx in the repo's data folder (as shipped in the current build). Never throws. */
export async function loadWorkbooks(): Promise<Workbook[]> {
  const dir = path.join(process.cwd(), dataDir());
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => /\.xlsx$/i.test(n)).sort();
  } catch {
    return [];
  }
  const out: Workbook[] = [];
  for (const file of names) {
    try {
      const buf = await fs.readFile(path.join(dir, file));
      const sheets: Sheet[] = [];
      for (const name of await readSheetNames(buf)) {
        const rows = await readXlsxFile(buf, { sheet: name });
        const [head = [], ...body] = rows;
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
