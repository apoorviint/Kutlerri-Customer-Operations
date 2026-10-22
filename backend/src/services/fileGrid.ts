import { createReadStream } from "node:fs";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { streamXlsx } from "./xlsxStream.js";

export type Kind = "xlsx" | "csv";

export function fileKind(fileName: string): Kind {
  const e = extname(fileName).toLowerCase();
  if (e === ".xlsx" || e === ".xlsm") return "xlsx";
  if (e === ".csv" || e === ".txt") return "csv";
  throw new Error("Upload an .xlsx or .csv file (older .xls files: save as .xlsx first).");
}

/** A cell as plain data: formulas give their result, rich text its text, hyperlinks their text. */
export function plain(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return plain(o.result as ExcelJS.CellValue);
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return null;
  }
  return v;
}

const rowValues = (r: ExcelJS.Row) => {
  const vals = (r.values as ExcelJS.CellValue[]).slice(1); // exceljs rows are 1-based
  return Array.from({ length: vals.length }, (_, i) => plain(vals[i]));
};

export type Sheet = { name: string; rows: unknown[][] };

/**
 * Reads a whole (small) file into rows of cells. Used for the assignment and billing sheets, which are never large.
 * A workbook with several sheets returns every sheet; the first one with data is what the callers use unless told otherwise.
 */
export async function readSheets(path: string, fileName: string): Promise<Sheet[]> {
  if (fileKind(fileName) === "csv") {
    const rows: unknown[][] = [];
    await new Promise<void>((resolve, reject) => {
      createReadStream(path).pipe(parse({ relax_column_count: true, bom: true, skip_empty_lines: true, relax_quotes: true }))
        .on("data", (r: string[]) => rows.push(r)).on("end", () => resolve()).on("error", reject);
    });
    return [{ name: "Sheet1", rows }];
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb.worksheets.map((ws) => {
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => rows.push(rowValues(r)));
    return { name: ws.name, rows };
  });
}

/** The sheet to use: the one asked for, else the first that has any cells. */
export function pickSheet(sheets: Sheet[], wanted?: string): Sheet {
  const s = (wanted && sheets.find((x) => x.name === wanted)) || sheets.find((x) => x.rows.length) || sheets[0];
  if (!s) throw new Error("The file has no sheets.");
  return s;
}

/**
 * Streams a (possibly large) file one sheet at a time without loading it whole: `onSheet` is called when a sheet starts,
 * then `onRow` for each of its rows. A prospect database of 15 MB with several sheets is read this way.
 * Both callbacks are synchronous on purpose: the reader must never wait on the database between rows.
 */
export async function streamRows(
  path: string, fileName: string,
  onSheet: (name: string) => void, onRow: (row: unknown[], rowNo: number) => void,
) {
  if (fileKind(fileName) === "csv") {
    onSheet("Sheet1");
    const parser = createReadStream(path).pipe(parse({ relax_column_count: true, bom: true, skip_empty_lines: true, relax_quotes: true }));
    let n = 0;
    for await (const r of parser) onRow(r as string[], ++n);
    return;
  }
  await streamXlsx(path, onSheet, onRow);
}
