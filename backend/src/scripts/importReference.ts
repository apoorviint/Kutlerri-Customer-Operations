/**
 * Loads the phone-number sheet (who dialed for whom) that is embedded in the prototype HTML, plus the legacy overrides.
 *
 *   npx tsx src/scripts/importReference.ts "<path to Customer_Success_Operations_Dashboard.html>"
 *
 * The HTML is not part of the repository (it holds company data), so the path is given on the command line.
 * Running it twice changes nothing.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { db } from "../db.js";
import { last10 } from "../rules/calls.js";
import type { ParsedRow } from "../rules/assignmentSheet.js";
import { addDays } from "../rules/periods.js";
import { commitAssignments, fileHash } from "../services/assignments.js";
import { attributeAndRollup } from "../services/attribution.js";
import { ensureReferenceData } from "../services/referenceData.js";
import { loadSettings } from "../services/settings.js";

type Seed = {
  dims: { reps: string[]; customers: { name: string; kind: string }[] };
  mapping: { cols: string[]; rows: [string, number, number, string][] };
};

// Lines the legacy workbook never listed. They only fill gaps: any sheet row for the same day wins.
const OVERRIDES: { phone: string; rep: string; client: string; from: string; to: string | null; note: string }[] = [
  { phone: "(347) 269-4977", rep: "Arman Agrawal", client: "Kutlerri", from: "2026-08-17", to: null, note: "Albert: Kutlerri's own line" },
  { phone: "(678) 712-1683", rep: "Arman Agrawal", client: "Kutlerri", from: "2026-08-17", to: null, note: "Albert 2: Kutlerri's own line" },
  { phone: "(202) 932-0552", rep: "Arman Agrawal", client: "Kutlerri", from: "2026-08-17", to: null, note: "Scott: Kutlerri's own line" },
  { phone: "(940) 245-4087", rep: "Dave", client: "Cedar's", from: "2026-08-17", to: null, note: "Dave's line belongs to Cedar's" },
  { phone: "(929) 521-6672", rep: "Dave", client: "Eight Turn Crepe", from: "2026-09-07", to: "2026-09-13", note: "Eight Turn Crepe for the week of Sep 7 (the sheet starts Sep 14)" },
];

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: tsx src/scripts/importReference.ts "<path to the prototype HTML>"');
  const html = readFileSync(path, "utf8");
  const m = html.match(/<script type="application\/json" id="seed-data">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Could not find the embedded data in that file.");
  const seed = JSON.parse(m[1]) as Seed;

  await ensureReferenceData();
  const rows: ParsedRow[] = [];
  seed.mapping.rows.forEach(([week, rep, cust, number], i) => {
    const client = seed.dims.customers[cust];
    const phone = last10(number);
    if (!phone || client.kind === "unmatched" || seed.dims.reps[rep] === "—") return;
    rows.push({ rowNo: i + 1, representative: seed.dims.reps[rep], client: client.name, phoneNo10: phone, from: week, to: addDays(week, 6), granularity: "weekly" });
  });

  const sheet = await commitAssignments({ rows, layout: "reference" }, { source: "reference-import", fileName: basename(path), fileHash: fileHash(JSON.stringify(seed.mapping)), uploadedBy: "import script" });
  console.log(sheet.committed
    ? `Phone list: saved ${sheet.preview.rows} rows over ${sheet.preview.periods.length} weeks (${sheet.preview.totals.added} added).`
    : "Phone list: already loaded, nothing to change.");
  for (const w of sheet.preview.warnings) console.log("  warning:", w);

  const overrides: ParsedRow[] = OVERRIDES.map((o, i) => ({ rowNo: i + 1, representative: o.rep, client: o.client, phoneNo10: last10(o.phone)!, from: o.from, to: o.to, granularity: "override" }));
  const fb = await commitAssignments({ rows: overrides, layout: "overrides" }, { source: "override", fileName: "legacy overrides", fileHash: fileHash(JSON.stringify(OVERRIDES)), uploadedBy: "import script", priority: 0 });
  console.log(fb.committed ? `Fallback lines: saved ${fb.preview.rows}.` : "Fallback lines: already loaded.");

  const settings = await loadSettings();
  const r = await attributeAndRollup(settings.backfillStart);
  console.log("Attribution:", JSON.stringify(r.attribution), "| daily rows:", r.rollups.rows);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
