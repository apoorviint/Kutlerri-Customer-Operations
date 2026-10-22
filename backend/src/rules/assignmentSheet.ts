import { last10 } from "./calls.js";
import { parseHeading, type Granularity } from "./periods.js";

/**
 * Reads the "who dialed for whom" sheet from a grid of cells (the file reader turns an xlsx or csv into rows of cells).
 *
 * Two layouts are understood:
 *  - the legacy wide sheet: one column per period ("Week of Aug 17", "Month of Oct", "Oct 19"). Column A holds the
 *    Representative and carries down through blank cells, column B the client, and a cell holds a phone number
 *    (or "-" / blank when the line was not used);
 *  - the normalized template: Representative | Client | Phone number plus a Date, Week, Month or Valid from / Valid to column.
 */
export type ParsedRow = {
  rowNo: number; // the row in the file, for error messages
  representative: string;
  client: string;
  phoneNo10: string;
  from: string;
  to: string | null;
  granularity: Granularity;
  cell?: string;
};

export type ParsedSheet = { layout: "legacy" | "normalized" | "unknown"; rows: ParsedRow[]; warnings: string[]; errors: string[]; columns: string[] };

const text = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());

/** Every phone number written in a cell (a cell may list more than one). */
export function extractPhones(cell: unknown): string[] {
  const s = typeof cell === "number" ? String(Math.round(cell)) : text(cell);
  if (!s) return [];
  const found = s.match(/(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/g) ?? [];
  return [...new Set(found.map((f) => last10(f)).filter((x): x is string => !!x))];
}

const isUnused = (s: string) => s === "" || /^[-–—]+$/.test(s) || /^(n\/?a|none|nil|x)$/i.test(s);

export function parseAssignmentSheet(grid: unknown[][], opts: { anchor: string }): ParsedSheet {
  const out: ParsedSheet = { layout: "unknown", rows: [], warnings: [], errors: [], columns: [] };
  const rows = grid.filter((r) => Array.isArray(r) && r.some((c) => text(c) !== ""));
  if (!rows.length) return { ...out, errors: ["The file is empty."] };

  // ── normalized template: find a header row naming Representative, Client and Phone
  const named = (r: unknown[]) => r.map((c) => text(c).toLowerCase());
  const nh = rows.findIndex((r) => {
    const n = named(r);
    return n.some((x) => /^rep/.test(x)) && n.some((x) => x === "client") && n.some((x) => /phone|number/.test(x));
  });
  if (nh >= 0) return parseNormalized(rows, nh, opts.anchor, out);

  // ── legacy wide sheet: the header row is the first one with at least one period heading
  const lh = rows.findIndex((r) => r.some((c, i) => i >= 2 && parseHeading(c, opts.anchor)));
  if (lh >= 0) return parseLegacy(rows, lh, opts.anchor, out);

  out.errors.push("This does not look like a who-dialed-for-whom sheet: no period headings (such as \"Week of Aug 17\") and no Representative / Client / Phone columns were found.");
  return out;
}

function parseLegacy(rows: unknown[][], head: number, anchor: string, out: ParsedSheet): ParsedSheet {
  out.layout = "legacy";
  const periods = rows[head]
    .map((c, i) => ({ i, h: i >= 2 ? parseHeading(c, anchor) : null, label: text(c) }))
    .filter((x) => x.h);
  out.columns = periods.map((p) => p.label);
  for (const p of periods) if (p.h!.warning) out.warnings.push(p.h!.warning);

  let rep = "";
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const a = text(row[0]);
    if (a) rep = a; // the Representative's name continues down through blank cells
    const client = text(row[1]);
    for (const p of periods) {
      const cell = row[p.i];
      const raw = text(cell);
      if (isUnused(raw)) continue;
      const phones = extractPhones(cell);
      if (!phones.length) {
        out.warnings.push(`Row ${r + 1}, "${p.label}": "${raw}" is not a phone number and was ignored.`);
        continue;
      }
      if (!rep || !client) {
        out.errors.push(`Row ${r + 1}, "${p.label}": a number is listed but the ${!rep ? "Representative" : "client"} is blank.`);
        continue;
      }
      for (const phone of phones) {
        out.rows.push({ rowNo: r + 1, representative: rep, client, phoneNo10: phone, from: p.h!.period.from, to: p.h!.period.to, granularity: p.h!.period.granularity, cell: raw });
      }
    }
  }
  if (!out.rows.length && !out.errors.length) out.errors.push("No phone numbers were found under any period heading.");
  return out;
}

function parseNormalized(rows: unknown[][], head: number, anchor: string, out: ParsedSheet): ParsedSheet {
  out.layout = "normalized";
  const names = rows[head].map((c) => text(c).toLowerCase());
  const col = (re: RegExp) => names.findIndex((n) => re.test(n));
  const c = {
    rep: col(/^rep/), client: col(/^client$/), phone: col(/phone|number/), date: col(/^(date|day)$/), week: col(/^week/), month: col(/^month/),
    from: col(/^valid.?from|^from$|^start/), to: col(/^valid.?to|^to$|^end/),
  };
  out.columns = rows[head].map(text).filter(Boolean);

  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const rep = text(row[c.rep]), client = text(row[c.client]);
    const phones = extractPhones(row[c.phone]);
    if (!rep && !client && !phones.length) continue;
    if (!phones.length) { out.errors.push(`Row ${r + 1}: no valid phone number ("${text(row[c.phone])}").`); continue; }
    if (!rep || !client) { out.errors.push(`Row ${r + 1}: the ${!rep ? "Representative" : "client"} is blank.`); continue; }

    let period: { from: string; to: string | null; granularity: Granularity } | null = null;
    if (c.from >= 0 && text(row[c.from])) {
      const f = parseHeading(row[c.from], anchor), t = c.to >= 0 && text(row[c.to]) ? parseHeading(row[c.to], anchor) : null;
      if (f && f.period.granularity === "daily" && (c.to < 0 || !text(row[c.to]) || (t && t.period.granularity === "daily"))) {
        period = { from: f.period.from, to: t ? t.period.from : null, granularity: "custom" };
      }
    } else {
      for (const [idx, label] of [[c.date, "date"], [c.week, "week"], [c.month, "month"]] as const) {
        if (idx < 0 || !text(row[idx])) continue;
        const raw = row[idx];
        const h = parseHeading(typeof raw === "string" && label !== "date" ? `${label} of ${raw}` : raw, anchor) ?? parseHeading(raw, anchor);
        if (h) { period = h.period; if (h.warning) out.warnings.push(`Row ${r + 1}: ${h.warning}`); break; }
      }
    }
    if (!period) { out.errors.push(`Row ${r + 1}: no usable date, week, month or valid-from for this row.`); continue; }
    for (const phone of phones) out.rows.push({ rowNo: r + 1, representative: rep, client, phoneNo10: phone, from: period.from, to: period.to, granularity: period.granularity });
  }
  if (!out.rows.length && !out.errors.length) out.errors.push("The template has no data rows.");
  return out;
}
