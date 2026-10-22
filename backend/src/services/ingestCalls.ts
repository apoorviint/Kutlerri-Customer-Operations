import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { agentKey, last10, mapDirection, mapDisposition, type Direction } from "../rules/calls.js";
import { resolveCallZone, shiftDate, toUtc, type TzRule } from "../rules/time.js";
import { fetchWindow } from "./callLogsApi.js";
import type { Settings } from "./settings.js";

const str = z.union([z.string(), z.number()]).nullish().transform((v) => (v == null || v === "" ? null : String(v)));

const CallItem = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  contact_no: str,
  justcall_no: str,
  justcall_no_name: str,
  agent_name: str,
  recording_url: str,
  duration: z.number().nullish().transform((v) => Math.max(0, Math.round(v ?? 0))),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // as logged by the provider
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  disposition_code: str,
  synced_at: z.string().nullish(),
  // The API does not send a direction today. When it does, it is read from whichever of these names it uses.
  direction: str,
  call_direction: str,
  call_type: str,
  type: str,
});

export type CallContext = {
  settings: Settings;
  rules: TzRule[];
  agentIds: Map<string, number>; // agent key -> id
};

export type CallRow = {
  id: string;
  contactNo10: string | null;
  justcallNo10: string | null;
  lineName: string | null;
  agentKey: string;
  agentName: string | null;
  recordingUrl: string | null;
  durationSec: number;
  localDate: string;
  localTime: string;
  tzUsed: string;
  occurredAt: Date;
  shiftDate: string;
  dispositionRaw: string | null;
  dispositionKey: string | null;
  unknownDisposition: boolean;
  direction: Direction | null;
  unknownDirection: string | null; // the text we did not recognise
  providerSyncedAt: Date | null;
  raw: unknown;
};

/** One API row -> a stored row. Throws if the row is unusable (the caller counts and reports it). */
export function mapCall(raw: unknown, ctx: Pick<CallContext, "settings" | "rules">): CallRow {
  const r = CallItem.parse(raw);
  const key = agentKey(r.agent_name);
  const lineNo10 = last10(r.justcall_no);
  const tzUsed = resolveCallZone(ctx.rules, { agentKey: key, lineNo10, localDate: r.date }, ctx.settings.callDefaultZone);
  const occurredAt = toUtc(r.date, r.time, tzUsed);
  const d = mapDisposition(r.disposition_code);
  const rawDirection = r.direction ?? r.call_direction ?? r.call_type ?? r.type;
  const dir = mapDirection(rawDirection);
  const synced = r.synced_at ? new Date(r.synced_at) : null;
  return {
    id: r.id,
    contactNo10: last10(r.contact_no),
    justcallNo10: lineNo10,
    lineName: r.justcall_no_name,
    agentKey: key,
    agentName: r.agent_name,
    recordingUrl: r.recording_url,
    durationSec: r.duration,
    localDate: r.date,
    localTime: r.time.length === 5 ? `${r.time}:00` : r.time,
    tzUsed,
    occurredAt,
    shiftDate: shiftDate(occurredAt, ctx.settings.shiftZone, ctx.settings.shiftStartHour),
    dispositionRaw: r.disposition_code,
    dispositionKey: d.key,
    unknownDisposition: d.unknown,
    direction: dir.direction,
    unknownDirection: dir.unknown ? rawDirection : null,
    providerSyncedAt: synced && !isNaN(synced.getTime()) ? synced : null,
    raw,
  };
}

/** Makes sure every agent name seen has a row (a new person starts with no Representative until an admin maps them). */
async function ensureAgents(rows: CallRow[], agentIds: Map<string, number>) {
  const missing = new Map<string, string>();
  for (const r of rows) if (r.agentKey && !agentIds.has(r.agentKey)) missing.set(r.agentKey, r.agentName ?? r.agentKey);
  if (!missing.size) return;
  await db.agent.createMany({ data: [...missing].map(([key, name]) => ({ key, name })), skipDuplicates: true });
  for (const a of await db.agent.findMany({ where: { key: { in: [...missing.keys()] } } })) agentIds.set(a.key, a.id);
}

/** Inserts new calls and updates changed ones. A row that has not changed is left alone. */
export async function upsertCalls(rows: CallRow[], agentIds: Map<string, number>) {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (!unique.length) return { inserted: 0, updated: 0, unchanged: 0 };
  await ensureAgents(unique, agentIds);
  const values = unique.map((r) => Prisma.sql`(
    ${r.id}, ${r.contactNo10}, ${r.justcallNo10}, ${r.lineName}, ${r.agentKey ? (agentIds.get(r.agentKey) ?? null) : null}, ${r.recordingUrl},
    ${r.durationSec}, ${r.localDate}::date, ${r.localTime}, ${r.tzUsed}, ${r.occurredAt.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${r.shiftDate}::date,
    ${r.dispositionRaw}, ${r.dispositionKey}, ${r.direction}, ${r.providerSyncedAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC', timezone('UTC', now()), timezone('UTC', now()), ${JSON.stringify(r.raw)}::jsonb)`);
  const result = await db.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO calls (id, contact_no10, justcall_no10, line_name, agent_id, recording_url, duration_sec, local_date, local_time, tz_used,
                       occurred_at, shift_date, disposition_raw, disposition_key, direction, provider_synced_at, ingested_at, updated_at, raw)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (id) DO UPDATE SET
      contact_no10 = EXCLUDED.contact_no10, justcall_no10 = EXCLUDED.justcall_no10, line_name = EXCLUDED.line_name,
      agent_id = EXCLUDED.agent_id, recording_url = EXCLUDED.recording_url, duration_sec = EXCLUDED.duration_sec,
      local_date = EXCLUDED.local_date, local_time = EXCLUDED.local_time, tz_used = EXCLUDED.tz_used,
      occurred_at = EXCLUDED.occurred_at, shift_date = EXCLUDED.shift_date, disposition_raw = EXCLUDED.disposition_raw,
      disposition_key = EXCLUDED.disposition_key, direction = EXCLUDED.direction, provider_synced_at = EXCLUDED.provider_synced_at,
      raw = EXCLUDED.raw, updated_at = timezone('UTC', now())
    WHERE (calls.contact_no10, calls.justcall_no10, calls.line_name, calls.agent_id, calls.recording_url, calls.duration_sec,
           calls.local_date, calls.local_time, calls.tz_used, calls.occurred_at, calls.shift_date, calls.disposition_raw,
           calls.disposition_key, calls.direction, calls.provider_synced_at, calls.raw)
      IS DISTINCT FROM
          (EXCLUDED.contact_no10, EXCLUDED.justcall_no10, EXCLUDED.line_name, EXCLUDED.agent_id, EXCLUDED.recording_url,
           EXCLUDED.duration_sec, EXCLUDED.local_date, EXCLUDED.local_time, EXCLUDED.tz_used, EXCLUDED.occurred_at,
           EXCLUDED.shift_date, EXCLUDED.disposition_raw, EXCLUDED.disposition_key, EXCLUDED.direction, EXCLUDED.provider_synced_at, EXCLUDED.raw)
    RETURNING (xmax = 0) AS inserted`;
  const inserted = result.filter((x) => x.inserted).length;
  return { inserted, updated: result.length - inserted, unchanged: unique.length - result.length };
}

export type WindowResult = {
  fetched: number; inserted: number; updated: number; unchanged: number; skipped: number;
  distinct: number; total: number; passes: number;
  unknownDispositions: Record<string, number>; unknownDirections: Record<string, number>; errors: string[];
};

/** Reads one date window (the provider's own dates) from the API and stores it. Safe to run again and again. */
export async function ingestCallsWindow(ctx: CallContext, from: string, to: string): Promise<WindowResult> {
  const out: WindowResult = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, distinct: 0, total: 0, passes: 0, unknownDispositions: {}, unknownDirections: {}, errors: [] };
  const w = await fetchWindow("/v1/calls", "id", from, to, async (items) => {
    const rows: CallRow[] = [];
    for (const raw of items) {
      out.fetched++;
      try {
        const row = mapCall(raw, ctx);
        if (row.unknownDisposition) out.unknownDispositions[row.dispositionRaw!] = (out.unknownDispositions[row.dispositionRaw!] ?? 0) + 1;
        if (row.unknownDirection) out.unknownDirections[row.unknownDirection] = (out.unknownDirections[row.unknownDirection] ?? 0) + 1;
        rows.push(row);
      } catch (e) {
        out.skipped++;
        if (out.errors.length < 5) out.errors.push(e instanceof Error ? e.message.slice(0, 300) : String(e));
      }
    }
    const r = await upsertCalls(rows, ctx.agentIds);
    out.inserted += r.inserted;
    out.updated += r.updated;
    out.unchanged += r.unchanged;
  });
  return Object.assign(out, w);
}

export async function loadAgentIds(): Promise<Map<string, number>> {
  return new Map((await db.agent.findMany({ select: { id: true, key: true } })).map((a) => [a.key, a.id]));
}
