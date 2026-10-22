import unzipper from "unzipper";
import { SaxesParser, type SaxesTagPlain } from "saxes";

/**
 * Reads an .xlsx one row at a time without loading the workbook: the zip is opened by its index, the sheet names and the
 * shared strings are read first, then each sheet's XML is streamed through a SAX parser.
 * Values come back as text or numbers (dates are numbers here; the prospect databases do not need them).
 */
type Entry = unzipper.File;

async function readText(entry: Entry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of entry.stream()) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Feeds an entry to a SAX parser as it arrives (multi-byte characters split across chunks are handled by the decoder). */
async function parseEntry(entry: Entry, setup: (p: SaxesParser) => void) {
  const p = new SaxesParser();
  setup(p);
  const stream = entry.stream();
  stream.setEncoding("utf8");
  for await (const chunk of stream) p.write(chunk as string);
  p.close();
}

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

async function sharedStrings(entry: Entry | undefined): Promise<string[]> {
  const out: string[] = [];
  if (!entry) return out;
  let inSi = false, inT = false, skip = 0, cur = "";
  await parseEntry(entry, (p) => {
    p.on("opentag", (t: SaxesTagPlain) => {
      if (t.name === "si") { inSi = true; cur = ""; }
      else if (t.name === "rPh") skip++; // phonetic hints are not part of the text
      else if (t.name === "t" && inSi && !skip) inT = true;
    });
    p.on("text", (s) => { if (inT) cur += s; });
    p.on("closetag", (t: SaxesTagPlain) => {
      if (t.name === "t") inT = false;
      else if (t.name === "rPh") skip--;
      else if (t.name === "si") { out.push(cur); inSi = false; }
    });
  });
  return out;
}

async function sheetList(files: Map<string, Entry>): Promise<{ name: string; path: string }[]> {
  const wb = files.get("xl/workbook.xml");
  const rels = files.get("xl/_rels/workbook.xml.rels");
  if (!wb || !rels) throw new Error("This does not look like an .xlsx workbook.");
  const target = new Map<string, string>();
  await parseEntry(rels, (p) => p.on("opentag", (t: SaxesTagPlain) => {
    if (t.name === "Relationship") target.set(String(t.attributes.Id), String(t.attributes.Target));
  }));
  const sheets: { name: string; path: string }[] = [];
  await parseEntry(wb, (p) => p.on("opentag", (t: SaxesTagPlain) => {
    if (t.name !== "sheet") return;
    const rel = target.get(String(t.attributes["r:id"]));
    if (!rel) return;
    sheets.push({ name: String(t.attributes.name), path: rel.startsWith("/") ? rel.slice(1) : `xl/${rel}` });
  }));
  return sheets;
}

export async function streamXlsx(
  path: string, onSheet: (name: string) => void, onRow: (row: unknown[], rowNo: number) => void,
): Promise<void> {
  const dir = await unzipper.Open.file(path);
  const files = new Map(dir.files.map((f) => [f.path, f]));
  const strings = await sharedStrings(files.get("xl/sharedStrings.xml"));
  for (const sheet of await sheetList(files)) {
    const entry = files.get(sheet.path);
    if (!entry) continue;
    onSheet(sheet.name);
    let row: unknown[] = [];
    let rowNo = 0;
    let cell: { col: number; type: string } | null = null;
    let inV = false, inIs = false, inT = false, text = "";
    await parseEntry(entry, (p) => {
      p.on("opentag", (t: SaxesTagPlain) => {
        if (t.name === "row") { row = []; rowNo = Number(t.attributes.r) || rowNo + 1; }
        else if (t.name === "c") { cell = { col: colIndex(String(t.attributes.r ?? "")), type: String(t.attributes.t ?? "n") }; text = ""; }
        else if (t.name === "v") inV = true;
        else if (t.name === "is") inIs = true;
        else if (t.name === "t" && inIs) inT = true;
      });
      p.on("text", (s) => { if (inV || inT) text += s; });
      p.on("closetag", (t: SaxesTagPlain) => {
        if (t.name === "v") inV = false;
        else if (t.name === "t") inT = false;
        else if (t.name === "is") inIs = false;
        else if (t.name === "c" && cell) {
          let v: unknown = null;
          if (text !== "") {
            if (cell.type === "s") v = strings[Number(text)] ?? null;
            else if (cell.type === "inlineStr" || cell.type === "str" || cell.type === "e") v = text;
            else if (cell.type === "b") v = text === "1";
            else v = Number.isFinite(Number(text)) ? Number(text) : text;
          }
          if (cell.col >= 0) { while (row.length < cell.col) row.push(null); row[cell.col] = v; }
          cell = null;
        } else if (t.name === "row") {
          if (row.some((c) => c !== null && c !== "")) onRow(row, rowNo);
        }
      });
    });
  }
}
