import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { resolveEmailClient } from "../rules/emails.js";
import { resolveCallZone, shiftDate, toUtc } from "../rules/time.js";
import { loadEmailRules, loadTzRules } from "./referenceData.js";
import { loadSettings } from "./settings.js";

const BATCH = 5000;

/**
 * Re-applies the time rules (time zone rules, shift start, default zone) to calls that are already stored.
 * It works from the date and time the provider sent, which we keep, so nothing is fetched again.
 */
export async function recomputeCallTimes(from?: string, to?: string, onProgress?: (done: number) => void) {
  const [settings, rules] = await Promise.all([loadSettings(), loadTzRules()]);
  let last = "";
  let scanned = 0;
  let changed = 0;
  for (;;) {
    const rows = await db.$queryRaw<
      { id: string; local_date: string; local_time: string; justcall_no10: string | null; agent_key: string | null; tz_used: string; occurred_at: Date; shift_date: string }[]
    >`
      SELECT c.id, to_char(c.local_date, 'YYYY-MM-DD') AS local_date, c.local_time, c.justcall_no10, a.key AS agent_key,
             c.tz_used, c.occurred_at, to_char(c.shift_date, 'YYYY-MM-DD') AS shift_date
      FROM calls c LEFT JOIN agents a ON a.id = c.agent_id
      WHERE c.id > ${last}
        ${from ? Prisma.sql`AND c.local_date >= ${from}::date` : Prisma.empty}
        ${to ? Prisma.sql`AND c.local_date <= ${to}::date` : Prisma.empty}
      ORDER BY c.id LIMIT ${BATCH}`;
    if (!rows.length) break;
    last = rows[rows.length - 1].id;
    scanned += rows.length;

    const updates: Prisma.Sql[] = [];
    for (const r of rows) {
      const zone = resolveCallZone(rules, { agentKey: r.agent_key, lineNo10: r.justcall_no10, localDate: r.local_date }, settings.callDefaultZone);
      const occurred = toUtc(r.local_date, r.local_time, zone);
      const sd = shiftDate(occurred, settings.shiftZone, settings.shiftStartHour);
      if (zone !== r.tz_used || occurred.getTime() !== r.occurred_at.getTime() || sd !== r.shift_date) {
        updates.push(Prisma.sql`(${r.id}, ${zone}, ${occurred.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${sd}::date)`);
      }
    }
    if (updates.length) {
      await db.$executeRaw`
        UPDATE calls c SET tz_used = v.tz, occurred_at = v.occ, shift_date = v.sd, updated_at = timezone('UTC', now())
        FROM (VALUES ${Prisma.join(updates)}) AS v(id, tz, occ, sd) WHERE c.id = v.id`;
      changed += updates.length;
    }
    onProgress?.(scanned);
    if (rows.length < BATCH) break;
  }
  return { scanned, changed };
}

/** Re-applies the email-to-client rules (sender domain, mailbox, sequence) to emails that are already stored. */
export async function recomputeEmailClients() {
  const rules = await loadEmailRules();
  const combos = await db.$queryRaw<{ mailbox: string | null; sequence: string | null }[]>`SELECT DISTINCT mailbox, sequence FROM emails`;
  let changed = 0;
  for (const c of combos) {
    const clientId = resolveEmailClient(rules, { from: c.mailbox, sequence: c.sequence });
    changed += await db.$executeRaw`
      UPDATE emails SET client_id = ${clientId}, updated_at = timezone('UTC', now())
      WHERE mailbox IS NOT DISTINCT FROM ${c.mailbox} AND sequence IS NOT DISTINCT FROM ${c.sequence}
        AND client_id IS DISTINCT FROM ${clientId}`;
  }
  return { scanned: combos.length, changed };
}
