import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { attributeCall, INBOUND, type Assignment, type Attribution } from "../rules/assignments.js";
import { CONNECT_KEYS, DISPOSITION_KEYS, MEANINGFUL_SECONDS } from "../rules/calls.js";
import { loadActiveAssignments } from "./assignments.js";
import { loadSettings } from "./settings.js";

const BATCH = 5000;

export type AttributionResult = { scanned: number; changed: number; byStatus: Record<string, number> };

type Pending = { id: string; phone: string | null; shift: string; repId: number | null; att: Attribution };

/**
 * Works out which Representative and client each call belongs to, from the call's phone line, its shift day and,
 * for a shared line, its agent. Safe to run again over any range of shift days (it only rewrites rows that changed).
 *
 * Two passes: first every call on a line the sheet lists (which also records which clients each Representative dialed
 * for on each shift day), then the calls on lines the sheet does not list, which go to the agent's Representative when
 * that is clear (see `agentFallback` in rules/assignments.ts).
 */
export async function attributeCalls(from?: string, to?: string, onProgress?: (done: number) => void): Promise<AttributionResult> {
  const assignments = await loadActiveAssignments();
  const byPhone = new Map<string, Assignment[]>();
  for (const a of assignments) (byPhone.get(a.phoneNo10) ?? byPhone.set(a.phoneNo10, []).get(a.phoneNo10)!).push(a);
  const agentRep = new Map((await db.agent.findMany({ select: { id: true, representativeId: true } })).map((a) => [a.id, a.representativeId]));

  const settings = await loadSettings();
  const fallbackOn = settings.agentFallback;
  const neverFallback = new Set(settings.agentFallbackExcludedLines);
  const byRep = new Map<number, Assignment[]>(); // each Representative's own sheet rows
  if (fallbackOn) for (const a of assignments) if (a.priority > 0) (byRep.get(a.representativeId) ?? byRep.set(a.representativeId, []).get(a.representativeId)!).push(a);

  const all: Pending[] = [];
  const usedClients = new Map<string, Set<number>>(); // "representative|shift day" -> clients of the listed lines they dialed

  // pass 1: calls on lines the sheet lists
  let last = "";
  for (;;) {
    const calls = await db.$queryRaw<{ id: string; phone: string | null; shift: string; agent_id: number | null; direction: string | null }[]>`
      SELECT id, justcall_no10 AS phone, to_char(shift_date, 'YYYY-MM-DD') AS shift, agent_id, direction
      FROM calls WHERE id > ${last}
        ${from ? Prisma.sql`AND shift_date >= ${from}::date` : Prisma.empty}
        ${to ? Prisma.sql`AND shift_date <= ${to}::date` : Prisma.empty}
      ORDER BY id LIMIT ${BATCH}`;
    if (!calls.length) break;
    last = calls[calls.length - 1].id;
    for (const c of calls) {
      const repId = c.agent_id !== null ? (agentRep.get(c.agent_id) ?? null) : null;
      // only calls made from our side count: one the source calls inbound is not attributed to anyone
      const att = settings.outboundOnly && c.direction === "inbound" ? INBOUND : attributeCall(c.phone ? (byPhone.get(c.phone) ?? []) : [], c.shift, repId);
      if (att.status === "CLIENT" && repId !== null) {
        const key = `${repId}|${c.shift}`;
        (usedClients.get(key) ?? usedClients.set(key, new Set()).get(key)!).add(att.clientId!);
      }
      all.push({ id: c.id, phone: c.phone, shift: c.shift, repId, att });
    }
    onProgress?.(all.length);
    if (calls.length < BATCH) break;
  }

  // pass 2: calls on lines the sheet does not list
  if (fallbackOn) {
    for (const p of all) {
      if (p.att.status !== "UNASSIGNED" || p.repId === null || (p.phone && neverFallback.has(p.phone))) continue;
      p.att = attributeCall([], p.shift, p.repId, byRep.get(p.repId) ?? null, usedClients.get(`${p.repId}|${p.shift}`) ?? null);
    }
  }

  const result: AttributionResult = { scanned: all.length, changed: 0, byStatus: {} };
  for (let i = 0; i < all.length; i += BATCH) {
    const values = all.slice(i, i + BATCH).map(({ id, att }) => {
      result.byStatus[att.status] = (result.byStatus[att.status] ?? 0) + 1;
      return Prisma.sql`(${id}, ${att.status}, ${att.clientId}, ${att.representativeId}, ${att.assignmentId}, ${att.reason}, timezone('UTC', now()))`;
    });
    const changed = await db.$queryRaw<{ call_id: string }[]>`
      INSERT INTO call_attribution (call_id, status, client_id, representative_id, assignment_id, reason, computed_at)
      VALUES ${Prisma.join(values)}
      ON CONFLICT (call_id) DO UPDATE SET status = EXCLUDED.status, client_id = EXCLUDED.client_id,
        representative_id = EXCLUDED.representative_id, assignment_id = EXCLUDED.assignment_id, reason = EXCLUDED.reason, computed_at = EXCLUDED.computed_at
      WHERE (call_attribution.status, call_attribution.client_id, call_attribution.representative_id, call_attribution.assignment_id, call_attribution.reason)
        IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.client_id, EXCLUDED.representative_id, EXCLUDED.assignment_id, EXCLUDED.reason)
      RETURNING call_id`;
    result.changed += changed.length;
  }
  return result;
}

const keyList = (keys: readonly string[]) => Prisma.join(keys.map((k) => Prisma.sql`${k}`));
const count = (key: string) => Prisma.sql`count(*) FILTER (WHERE c.disposition_key = ${key})::int`;

/**
 * Rebuilds the daily counts for a range of shift days (all of them if none is given) from the calls and their attribution.
 * Only calls that belong to a client are counted; internal and unassigned calls are left for the admin data-quality view.
 * The range is replaced as a whole, so running it again gives the same result.
 */
export async function rebuildRollups(from?: string, to?: string): Promise<{ rows: number }> {
  const range = Prisma.sql`${from ? Prisma.sql`AND c.shift_date >= ${from}::date` : Prisma.empty} ${to ? Prisma.sql`AND c.shift_date <= ${to}::date` : Prisma.empty}`;
  const del = Prisma.sql`${from ? Prisma.sql`shift_date >= ${from}::date` : Prisma.sql`true`} ${to ? Prisma.sql`AND shift_date <= ${to}::date` : Prisma.empty}`;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM daily_rollups WHERE ${del}`;
    const n = await tx.$executeRaw`
      INSERT INTO daily_rollups (shift_date, client_id, representative_id, agent_id, line_no10, calls, meaningful, mql_over_90,
        d_mql, d_interested, d_callback, d_not_interested, d_wrong_number, d_mql_fu, d_dnc, d_no_answer, d_bad_number, d_voicemail, d_meeting, d_blank, d_other)
      SELECT c.shift_date, a.client_id, a.representative_id, c.agent_id, c.justcall_no10,
        count(*)::int,
        count(*) FILTER (WHERE c.disposition_key IN (${keyList(CONNECT_KEYS)}) AND c.duration_sec > ${MEANINGFUL_SECONDS})::int,
        count(*) FILTER (WHERE c.disposition_key = 'mql' AND c.duration_sec > ${MEANINGFUL_SECONDS})::int,
        ${count("mql")}, ${count("interested")}, ${count("callback")}, ${count("not_interested")}, ${count("wrong_number")}, ${count("mql_fu")}, ${count("dnc")},
        ${count("no_answer")}, ${count("bad_number")}, ${count("voicemail")}, ${count("meeting")},
        count(*) FILTER (WHERE c.disposition_key IS NULL AND c.disposition_raw IS NULL)::int,
        count(*) FILTER (WHERE c.disposition_key IS NULL AND c.disposition_raw IS NOT NULL)::int
      FROM calls c JOIN call_attribution a ON a.call_id = c.id
      WHERE a.status = 'CLIENT' ${range}
      GROUP BY c.shift_date, a.client_id, a.representative_id, c.agent_id, c.justcall_no10`;
    return { rows: n };
  }, { timeout: 120_000, maxWait: 30_000 });
}

/** Attribution then the daily counts, for the same range. This is what runs after new calls, new assignments or new rules. */
export async function attributeAndRollup(from?: string, to?: string, onProgress?: (done: number) => void) {
  const attribution = await attributeCalls(from, to, onProgress);
  const rollups = await rebuildRollups(from, to);
  return { attribution, rollups };
}

export { DISPOSITION_KEYS };
