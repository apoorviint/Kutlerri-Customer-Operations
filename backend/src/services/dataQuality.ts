import { DateTime } from "luxon";
import { db } from "../db.js";
import { findSuspiciousSwaps } from "../rules/assignments.js";
import { totalMismatch } from "../rules/billingSheet.js";
import { loadActiveAssignments } from "./assignments.js";
import { loadSettings } from "./settings.js";

const STALE_HOURS = 2;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Everything an admin should look at: gaps and contradictions in the data, and whether the feeds are alive. */
export async function dataQuality() {
  const settings = await loadSettings();
  const since = settings.backfillStart;

  const [unassigned, undecided, twoClients, missingRecordings, unmappedAgents, unmappedEmails, orders, assignments, lastCalls, lastEmails, newestCall, newestEmail] = await Promise.all([
    db.$queryRaw<{ line: string | null; calls: number; first: string; last: string; agents: string[] }[]>`
      SELECT c.justcall_no10 AS line, count(*)::int AS calls, to_char(min(c.shift_date), 'YYYY-MM-DD') AS first, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last,
             array_agg(DISTINCT ag.name) FILTER (WHERE ag.name IS NOT NULL) AS agents
      FROM calls c JOIN call_attribution a ON a.call_id = c.id LEFT JOIN agents ag ON ag.id = c.agent_id
      WHERE a.status = 'UNASSIGNED' AND c.shift_date >= ${since}::date
      GROUP BY c.justcall_no10 ORDER BY count(*) DESC LIMIT 200`,
    db.$queryRaw<{ line: string | null; calls: number; first: string; last: string }[]>`
      SELECT c.justcall_no10 AS line, count(*)::int AS calls, to_char(min(c.shift_date), 'YYYY-MM-DD') AS first, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last
      FROM calls c JOIN call_attribution a ON a.call_id = c.id
      WHERE a.status = 'CONFLICT' AND c.shift_date >= ${since}::date GROUP BY c.justcall_no10 ORDER BY count(*) DESC LIMIT 100`,
    // one phone line listed for two different clients over overlapping dates, in the same uploaded sheet layer
    db.$queryRaw<{ phone: string; client_a: string; client_b: string; from_a: string; to_a: string | null; from_b: string; to_b: string | null }[]>`
      SELECT a.phone_no10 AS phone, ca.name AS client_a, cb.name AS client_b,
             to_char(a.valid_from, 'YYYY-MM-DD') AS from_a, to_char(a.valid_to, 'YYYY-MM-DD') AS to_a,
             to_char(b.valid_from, 'YYYY-MM-DD') AS from_b, to_char(b.valid_to, 'YYYY-MM-DD') AS to_b
      FROM line_assignments a
      JOIN line_assignments b ON b.phone_no10 = a.phone_no10 AND b.id > a.id AND b.client_id <> a.client_id
        AND a.valid_from <= coalesce(b.valid_to, 'infinity'::date) AND b.valid_from <= coalesce(a.valid_to, 'infinity'::date)
        AND a.valid_to IS NOT DISTINCT FROM b.valid_to AND a.valid_from = b.valid_from
      JOIN clients ca ON ca.id = a.client_id JOIN clients cb ON cb.id = b.client_id
      WHERE a.superseded_by_upload_id IS NULL AND b.superseded_by_upload_id IS NULL AND a.priority > 0 AND b.priority > 0
      ORDER BY a.valid_from DESC LIMIT 100`,
    db.$queryRaw<{ rep: string; calls: number; first: string; last: string }[]>`
      SELECT r.name AS rep, count(*)::int AS calls, to_char(min(c.shift_date), 'YYYY-MM-DD') AS first, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last
      FROM calls c JOIN call_attribution a ON a.call_id = c.id JOIN representatives r ON r.id = a.representative_id
      WHERE a.status = 'CLIENT' AND c.shift_date >= ${since}::date AND (c.recording_url IS NULL OR c.recording_url NOT LIKE 'https://%') AND c.duration_sec > 0
      GROUP BY r.name ORDER BY count(*) DESC`,
    db.agent.findMany({ where: { representativeId: null }, select: { id: true, name: true } }),
    db.$queryRaw<{ domain: string | null; emails: number }[]>`
      SELECT sender_domain AS domain, count(*)::int AS emails FROM emails WHERE client_id IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 50`,
    db.billingOrder.findMany({ orderBy: { orderDate: "desc" } }),
    loadActiveAssignments(),
    db.syncRun.findFirst({ where: { source: "calls", status: { in: ["ok", "warning"] } }, orderBy: { finishedAt: "desc" } }),
    db.syncRun.findFirst({ where: { source: "emails", status: { in: ["ok", "warning"] } }, orderBy: { finishedAt: "desc" } }),
    db.$queryRaw<{ t: Date | null }[]>`SELECT max(occurred_at) AS t FROM calls`,
    db.$queryRaw<{ t: Date | null }[]>`SELECT max(sent_at) AS t FROM emails`,
  ]);

  const [clients, reps] = await Promise.all([db.client.findMany(), db.representative.findMany()]);
  const clientName = new Map(clients.map((c) => [c.id, c.name])), repName = new Map(reps.map((r) => [r.id, r.name]));

  const discountMismatches = orders
    .map((o) => {
      const v = { subtotal: o.subtotal == null ? null : Number(o.subtotal), tax: o.tax == null ? null : Number(o.tax), tip: o.tip == null ? null : Number(o.tip), fee: o.fee == null ? null : Number(o.fee), discount: o.discount == null ? null : Number(o.discount), total: Number(o.total) };
      const diff = totalMismatch(v);
      return diff === null ? null : { invoiceNo: o.invoiceNo, client: clientName.get(o.clientId) ?? "", representative: repName.get(o.representativeId) ?? "", orderDate: iso(o.orderDate), total: v.total, expected: Math.round((v.total - diff) * 100) / 100, difference: diff };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  const swaps = findSuspiciousSwaps(
    assignments.filter((a) => a.priority > 0).map((a) => ({ phoneNo10: a.phoneNo10, representative: a.repName, client: a.clientName, from: a.validFrom, to: a.validTo })),
  );

  // is the calls feed alive? No new calls for more than 2 hours while a shift is running is a problem
  const nowIst = DateTime.now().setZone(settings.shiftZone);
  const inShift = nowIst.hour >= settings.shiftStartHour || nowIst.hour < 5;
  const newest = newestCall[0].t;
  const hoursSince = newest ? (Date.now() - newest.getTime()) / 3_600_000 : null;
  const stale = inShift && hoursSince !== null && hoursSince > STALE_HOURS;

  const alerts: string[] = [];
  if (stale) alerts.push(`No new calls for ${Math.floor(hoursSince!)} hours during a shift. The feed may be down.`);
  if (unassigned.length) alerts.push(`${unassigned.reduce((n, u) => n + u.calls, 0).toLocaleString()} calls have no client (${unassigned.length} phone lines not on the sheet).`);
  if (twoClients.length) alerts.push(`${twoClients.length} phone line(s) are listed for two clients in the same period.`);
  if (swaps.length) alerts.push(`${swaps.length} suspicious swap(s) in the sheet (two numbers trading clients).`);
  if (discountMismatches.length) alerts.push(`${discountMismatches.length} order(s) where Total does not equal Subtotal + Tax + Tip + Fee − Discount.`);
  if (unmappedAgents.length) alerts.push(`${unmappedAgents.length} agent(s) are not mapped to a Representative: ${unmappedAgents.map((a) => a.name).join(", ")}.`);
  if (unmappedEmails.length) alerts.push(`${unmappedEmails.reduce((n, u) => n + u.emails, 0)} email(s) could not be matched to a client.`);

  return {
    alerts,
    feeds: {
      calls: { lastSyncAt: lastCalls?.finishedAt ?? null, newestRecordAt: newest, hoursSinceNewest: hoursSince === null ? null : Math.round(hoursSince * 10) / 10, stale, inShift },
      emails: { lastSyncAt: lastEmails?.finishedAt ?? null, newestRecordAt: newestEmail[0].t },
    },
    unassigned, undecided,
    twoClients,
    swaps,
    discountMismatches,
    missingRecordings,
    unmappedAgents,
    unmappedEmails,
  };
}
