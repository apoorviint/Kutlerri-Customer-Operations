import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { contactsFromRow, findHeader, summarizeContacts, type Columns, type Contact } from "../rules/prospects.js";
import { audit } from "./audit.js";
import { streamRows } from "./fileGrid.js";
import { clearCache } from "./cache.js";
import { loadSettings } from "./settings.js";
import { keep, storedPath } from "./storage.js";

const INSERT_BATCH = 3000;

export type SheetReport = { name: string; rows: number; contacts: number; skipped: boolean; columns?: Record<string, string | number[]>; reason?: string };

/** How many of a client's calls (since the start date) have a prospect match now. Used to say how many were newly matched. */
async function matchedCalls(clientId: number): Promise<number> {
  const since = (await loadSettings()).backfillStart;
  const r = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM calls c JOIN call_attribution a ON a.call_id = c.id
    JOIN phone_matches pm ON pm.client_id = a.client_id AND pm.phone_no10 = c.contact_no10
    WHERE a.client_id = ${clientId} AND a.status = 'CLIENT' AND c.shift_date >= ${since}::date`;
  return r[0].n;
}

/**
 * Rebuilds one client's phone-match table from the databases currently in force (committed and not replaced).
 * Match rule: last 10 digits, within the same client only. Returns the number of phone numbers indexed.
 */
export async function rebuildMatches(clientId: number, dropReference = false, alsoBatchId = 0): Promise<number> {
  // matches imported from the prototype stay (they only cover numbers already called) unless a "replace" upload takes the client over
  await db.$executeRaw`DELETE FROM phone_matches WHERE client_id = ${clientId} AND (source = 'upload' OR ${dropReference})`;
  let last = "";
  let total = 0;
  for (;;) {
    const rows = await db.$queryRaw<{ phone: string; people: { n: string; t: string; c: string }[] }[]>`
      SELECT p.phone_no10 AS phone, jsonb_agg(DISTINCT jsonb_build_object('n', coalesce(p.name, ''), 't', coalesce(p.title, ''), 'c', coalesce(p.company, ''))) AS people
      FROM prospect_phones p JOIN prospect_batches b ON b.id = p.batch_id
      WHERE p.client_id = ${clientId} AND (b.status = 'committed' OR b.id = ${alsoBatchId}) AND b.superseded_by_id IS NULL AND p.phone_no10 > ${last}
      GROUP BY p.phone_no10 ORDER BY p.phone_no10 LIMIT 20000`;
    if (!rows.length) break;
    last = rows[rows.length - 1].phone;
    const values: Prisma.Sql[] = [];
    for (const r of rows) {
      const m = summarizeContacts(r.people.map((p) => ({ name: p.n, title: p.t, company: p.c })));
      if (m) values.push(Prisma.sql`(${clientId}, ${r.phone}, ${m.kind}, ${m.name}, ${m.company}, ${m.title}, ${m.candidates}, 'upload', timezone('UTC', now()))`);
    }
    for (let i = 0; i < values.length; i += 3000) {
      await db.$executeRaw`INSERT INTO phone_matches (client_id, phone_no10, kind, name, company, title, candidates, source, updated_at) VALUES ${Prisma.join(values.slice(i, i + 3000))}
        ON CONFLICT (client_id, phone_no10) DO UPDATE SET kind = EXCLUDED.kind, name = EXCLUDED.name, company = EXCLUDED.company, title = EXCLUDED.title, candidates = EXCLUDED.candidates, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`;
    }
    total += values.length;
    if (rows.length < 20000) break;
  }
  return total;
}

export type StartInput = { clientId: number; filePath: string; fileName: string; fileHash: string; replace: boolean; uploadedBy: string };

/** Creates the batch record; the file is read in the background (see processBatch). */
export async function startBatch(i: StartInput): Promise<number> {
  const b = await db.prospectBatch.create({ data: { clientId: i.clientId, fileName: i.fileName, fileHash: i.fileHash, replace: i.replace, uploadedBy: i.uploadedBy, status: "processing" } });
  const key = await keep("prospects", b.id, i.fileName, i.filePath);
  await db.prospectBatch.update({ where: { id: b.id }, data: { fileKey: key } });
  return b.id;
}

/**
 * Reads the file one row at a time (never the whole file in memory), stores each person's phone numbers,
 * then makes the batch current, rebuilds the client's match table and counts the newly matched calls.
 * Every sheet is read; a sheet with no recognisable header is skipped and reported rather than guessed at.
 */
export async function processBatch(batchId: number): Promise<void> {
  const batch = await db.prospectBatch.findUniqueOrThrow({ where: { id: batchId } });
  const client = await db.client.findUniqueOrThrow({ where: { id: batch.clientId } });
  const reports: SheetReport[] = [];
  let sheet = null as SheetReport | null;
  let header = null as { index: number; columns: Columns } | null;
  let pendingHeader: unknown[][] = [];
  let buffer: Prisma.ProspectPhoneCreateManyInput[] = [];
  const seen = new Set<string>();
  let rowsRead = 0;
  let lastProgress = 0;
  // The spreadsheet reader loses rows if the loop reading them waits for the database, so the loop never waits:
  // rows are collected and written by a separate chain of inserts that runs alongside the reading.
  let writes: Promise<unknown> = Promise.resolve();

  const schedule = () => {
    if (!buffer.length) return;
    const data = buffer;
    buffer = [];
    writes = writes.then(() => db.prospectPhone.createMany({ data }));
    writes.catch(() => {}); // the failure is raised where the chain is awaited below
  };
  const progress = () => {
    if (Date.now() - lastProgress < 700) return;
    lastProgress = Date.now();
    const rows = rowsRead;
    const name = sheet?.name ?? null;
    writes = writes.then(() => db.prospectBatch.update({ where: { id: batchId }, data: { rowsRead: rows, progress: { sheet: name, rows } } }));
    writes.catch(() => {});
  };
  const closeSheet = () => {
    if (!sheet) return;
    if (!header) { sheet.skipped = true; sheet.reason = "No header row with a name column and a phone/mobile column was found in the first 10 rows."; }
    reports.push(sheet);
    schedule();
  };
  const take = (row: unknown[]) => {
    rowsRead++;
    sheet!.rows++;
    for (const c of contactsFromRow(row, header!.columns) as Contact[]) {
      const k = `${c.phoneNo10}|${c.name}|${c.company}|${c.title}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sheet!.contacts++;
      buffer.push({ batchId, clientId: client.id, phoneNo10: c.phoneNo10, name: c.name || null, title: c.title || null, company: c.company || null });
    }
    if (buffer.length >= INSERT_BATCH) schedule();
    progress();
  };

  try {
    const before = await matchedCalls(client.id);
    await streamRows(batch.fileKey ? storedPath(batch.fileKey) : "", batch.fileName,
      (name) => {
        closeSheet();
        sheet = { name, rows: 0, contacts: 0, skipped: false };
        header = null;
        pendingHeader = [];
      },
      (row) => {
        if (!sheet) return;
        if (header) return take(row);
        // the header is within the first rows; keep them until it is found
        pendingHeader.push(row);
        const h = findHeader(pendingHeader);
        if (h) {
          header = h;
          sheet.columns = { phones: h.columns.phones, name: h.columns.name, first: h.columns.first, last: h.columns.last, title: h.columns.title, company: h.columns.company } as unknown as SheetReport["columns"];
          const rest = pendingHeader.slice(h.index + 1);
          pendingHeader = [];
          for (const r of rest) take(r);
        } else if (pendingHeader.length > 10) pendingHeader = pendingHeader.slice(0, 11); // give up looking
      },
    );
    closeSheet();
    await writes;

    const read = reports.filter((r) => !r.skipped);
    if (!read.length) throw new Error("None of the sheets has a header with a name column and a phone/mobile column, so nothing was read. " + reports.map((r) => `${r.name}: ${r.reason}`).join(" "));

    // make it current: a "replace" upload takes the client's place, an "append" adds to what is there
    // (the batch stays "processing" until every number is final, so nobody sees half-finished totals)
    if (batch.replace) {
      await db.prospectBatch.updateMany({ where: { clientId: client.id, status: "committed", supersededById: null, id: { not: batchId } }, data: { supersededById: batchId } });
    }
    const phones = await rebuildMatches(client.id, batch.replace, batchId);
    const after = await matchedCalls(client.id);
    await db.prospectBatch.update({
      where: { id: batchId },
      data: { status: "committed", rowsRead, phonesIndexed: phones, newlyMatched: Math.max(0, after - before), sheets: JSON.parse(JSON.stringify(reports)), finishedAt: new Date(), progress: Prisma.DbNull, error: null },
    });
    await audit(batch.uploadedBy ?? "system", "prospects.upload", `${client.name}: ${batch.fileName}`, { batchId, replace: batch.replace, rowsRead, phonesIndexed: phones, newlyMatched: Math.max(0, after - before) });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await writes.catch(() => {});
    await db.prospectPhone.deleteMany({ where: { batchId } });
    if (await db.prospectBatch.count({ where: { supersededById: batchId } })) {
      await db.prospectBatch.updateMany({ where: { supersededById: batchId }, data: { supersededById: null } });
      await rebuildMatches(client.id, false).catch(() => {});
    }
    await db.prospectBatch.update({ where: { id: batchId }, data: { status: "failed", error: error.slice(0, 2000), finishedAt: new Date(), sheets: JSON.parse(JSON.stringify(reports)), progress: Prisma.DbNull } });
  } finally {
    clearCache();
  }
}

/** Takes a batch out of force. A "replace" upload brings back the batches it replaced. */
export async function rollbackBatch(batchId: number, by: string): Promise<{ phones: number }> {
  const b = await db.prospectBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new Error("No such upload");
  if (b.status !== "committed") throw new Error(`This upload is ${b.status === "rolled_back" ? "already rolled back" : "not finished"}, so it cannot be rolled back`);
  if (b.supersededById) throw new Error("A later 'replace' upload took over from this one; roll that one back first");
  await db.$transaction([
    db.prospectBatch.update({ where: { id: batchId }, data: { status: "rolled_back" } }),
    db.prospectBatch.updateMany({ where: { supersededById: batchId }, data: { supersededById: null } }),
  ]);
  const phones = await rebuildMatches(b.clientId);
  const client = await db.client.findUnique({ where: { id: b.clientId } });
  await audit(by, "prospects.rollback", `${client?.name}: ${b.fileName}`, { batchId, phonesIndexed: phones });
  clearCache();
  return { phones };
}
