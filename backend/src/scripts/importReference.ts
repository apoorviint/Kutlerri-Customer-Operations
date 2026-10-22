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
  // [client, representative, created, order date, invoice, account, total, subtotal]
  billing: { rows: [number, number, string, string, string, string, number, number][] };
  // [date, time, representative, client, seconds, disposition, link, prospect index, phone]
  recordings: { rows: [string, string, number, number, number, number, string, number | null, string | null][] };
  // [name, company, title, other candidates]
  prospects: { rows: [string, string, string, string][] };
};

/** The 10 orders in the prototype's billing sheet (the upload screen comes in Phase 4). */
async function importBilling(seed: Seed) {
  const [clients, reps] = await Promise.all([db.client.findMany(), db.representative.findMany()]);
  const clientId = new Map(clients.map((c) => [c.name, c.id])), repId = new Map(reps.map((r) => [r.name, r.id]));
  let n = 0;
  for (const [cu, rep, created, order, invoice, account, total, subtotal] of seed.billing.rows) {
    const client = clientId.get(seed.dims.customers[cu].name), rp = repId.get(seed.dims.reps[rep]);
    if (!client || !rp) throw new Error(`Billing row ${invoice}: unknown client or Representative`);
    const data = { invoiceNo: String(invoice), clientId: client, representativeId: rp, createdDate: new Date(created), orderDate: new Date(order), account, subtotal, total };
    await db.billingOrder.upsert({ where: { invoiceNo: data.invoiceNo }, create: data, update: data });
    n++;
  }
  return n;
}

/**
 * Who each phone number belongs to, as the prototype worked it out from the six client databases: one person,
 * or several people sharing the number. Only numbers that were actually called are known (about 16,000);
 * the full databases are uploaded in Phase 4.
 */
async function importPhoneMatches(seed: Seed) {
  const clients = new Map((await db.client.findMany()).map((c) => [c.name, c.id]));
  const votes = new Map<string, Map<number, number>>(); // "client|phone" -> prospect index -> calls
  for (const r of seed.recordings.rows) {
    const idx = r[7], phone = last10(r[8]);
    if (idx === null || idx < 0 || !phone) continue;
    const k = `${r[3]}|${phone}`;
    const m = votes.get(k) ?? votes.set(k, new Map()).get(k)!;
    m.set(idx, (m.get(idx) ?? 0) + 1);
  }
  const rows: { clientId: number; phoneNo10: string; kind: string; name: string; company: string; title: string; candidates: string | null }[] = [];
  for (const [k, m] of votes) {
    const [cu, phone] = k.split("|");
    const clientId = clients.get(seed.dims.customers[Number(cu)].name);
    if (!clientId) continue;
    const idx = [...m].sort((a, b) => b[1] - a[1])[0][0];
    const [name, company, title, others] = seed.prospects.rows[idx];
    rows.push({ clientId, phoneNo10: phone, kind: others ? "multiple" : "one", name, company, title, candidates: others || null });
  }
  await db.phoneMatch.deleteMany({ where: { source: "reference-import" } });
  for (let i = 0; i < rows.length; i += 5000) await db.phoneMatch.createMany({ data: rows.slice(i, i + 5000), skipDuplicates: true });
  return rows.length;
}

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

  console.log(`Billing: ${await importBilling(seed)} orders.`);
  console.log(`Prospect matches: ${await importPhoneMatches(seed)} phone numbers.`);

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
