import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { CONNECT_KEYS, type DispositionKey } from "../rules/calls.js";
import { addRow, emptyTally, toStats, type RollupRow, type Tally } from "../rules/metrics.js";
import { addDays, daysBetween, mondayOf } from "../rules/periods.js";
import { weeklyRevenue, type Order } from "../rules/revenue.js";
import { analyzeRepDay, scheduleOf, summarize, type TimedCall } from "../rules/timing.js";
import { todayIn } from "../rules/time.js";
import { sanitizeEmailHtml } from "./sanitize.js";
import { loadSettings } from "./settings.js";

// ───────────────────────── shared helpers ─────────────────────────

export type Range = { from: string; to: string };

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date) => d.toISOString().slice(0, 10);

type Names = { clients: Map<number, { id: number; name: string; kind: string; sortOrder: number }>; reps: Map<number, { id: number; name: string; internal: boolean }> };
async function names(): Promise<Names> {
  const [clients, reps] = await Promise.all([db.client.findMany(), db.representative.findMany()]);
  return { clients: new Map(clients.map((c) => [c.id, { id: c.id, name: c.name, kind: c.kind, sortOrder: c.sortOrder }])), reps: new Map(reps.map((r) => [r.id, r])) };
}

type SqlRollup = {
  client_id?: number; representative_id?: number;
  calls: number; meaningful: number; mql_over_90: number;
  d_mql: number; d_interested: number; d_callback: number; d_not_interested: number; d_wrong_number: number; d_mql_fu: number; d_dnc: number;
  d_no_answer: number; d_bad_number: number; d_voicemail: number; d_meeting: number; d_blank: number; d_other: number;
};
const asRollup = (r: SqlRollup): RollupRow => ({
  calls: r.calls, meaningful: r.meaningful, mqlOver90: r.mql_over_90, dMql: r.d_mql, dInterested: r.d_interested, dCallback: r.d_callback,
  dNotInterested: r.d_not_interested, dWrongNumber: r.d_wrong_number, dMqlFu: r.d_mql_fu, dDnc: r.d_dnc, dNoAnswer: r.d_no_answer,
  dBadNumber: r.d_bad_number, dVoicemail: r.d_voicemail, dMeeting: r.d_meeting, dBlank: r.d_blank, dOther: r.d_other,
});

/** Daily counts for a range, summed per group (client and/or Representative). Only calls that belong to a client are in here. */
async function sumRollups(range: Range, groupBy: ("client_id" | "representative_id")[], where: Prisma.Sql = Prisma.empty) {
  const cols = Prisma.raw(groupBy.join(", "));
  const rows = await db.$queryRaw<SqlRollup[]>`
    SELECT ${cols}, sum(calls)::int AS calls, sum(meaningful)::int AS meaningful, sum(mql_over_90)::int AS mql_over_90,
      sum(d_mql)::int AS d_mql, sum(d_interested)::int AS d_interested, sum(d_callback)::int AS d_callback, sum(d_not_interested)::int AS d_not_interested,
      sum(d_wrong_number)::int AS d_wrong_number, sum(d_mql_fu)::int AS d_mql_fu, sum(d_dnc)::int AS d_dnc, sum(d_no_answer)::int AS d_no_answer,
      sum(d_bad_number)::int AS d_bad_number, sum(d_voicemail)::int AS d_voicemail, sum(d_meeting)::int AS d_meeting,
      sum(d_blank)::int AS d_blank, sum(d_other)::int AS d_other
    FROM daily_rollups
    WHERE shift_date BETWEEN ${range.from}::date AND ${range.to}::date ${where}
    GROUP BY ${cols}`;
  return rows;
}

const totalOf = (rows: SqlRollup[]): Tally => rows.reduce((t, r) => addRow(t, asRollup(r)), emptyTally());

async function ordersIn(range: Range, extra: Prisma.BillingOrderWhereInput = {}) {
  const rows = await db.billingOrder.findMany({ where: { orderDate: { gte: new Date(range.from), lte: new Date(range.to) }, ...extra } });
  return rows.map((o) => ({ date: day(o.orderDate), total: Number(o.total), clientId: o.clientId, representativeId: o.representativeId }));
}

// ───────────────────────── meta ─────────────────────────

export async function meta() {
  const [settings, lk, span] = await Promise.all([
    loadSettings(), names(),
    db.$queryRaw<{ first: string | null; last: string | null }[]>`
      SELECT to_char(min(shift_date), 'YYYY-MM-DD') AS first, to_char(max(shift_date), 'YYYY-MM-DD') AS last
      FROM daily_rollups`,
  ]);
  const first = span[0].first && span[0].first > settings.backfillStart ? span[0].first : settings.backfillStart;
  return {
    dateMin: first,
    dateMax: span[0].last ?? todayIn(settings.shiftZone),
    today: todayIn(settings.shiftZone),
    shiftZone: settings.shiftZone,
    meaningfulSeconds: 90,
    clients: [...lk.clients.values()].filter((c) => c.kind === "CUSTOMER").sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ id: c.id, name: c.name, showPhone: (settings.prospectShow[c.name] ?? []).includes("phone") })),
    representatives: [...lk.reps.values()].filter((r) => !r.internal).sort((a, b) => a.name.localeCompare(b.name)).map((r) => ({ id: r.id, name: r.name })),
    timing: settings.timing,
  };
}

// ───────────────────────── overview ─────────────────────────

export async function overview(range: Range) {
  const [lk, calls, orders, mail, weeksN, coverage] = await Promise.all([
    names(),
    sumRollups(range, ["client_id"]),
    ordersIn(range),
    db.$queryRaw<{ client_id: number; sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number }[]>`
      SELECT e.client_id, count(*) FILTER (WHERE e.sent)::int AS sent, count(*) FILTER (WHERE e.sent AND e.opened)::int AS opened,
             count(*) FILTER (WHERE e.sent AND e.clicked)::int AS clicked, count(*) FILTER (WHERE e.sent AND e.replied)::int AS replied,
             count(*) FILTER (WHERE e.sent AND e.bounced)::int AS bounced, count(*) FILTER (WHERE e.sent AND e.unsubscribed)::int AS unsubscribed
      FROM emails e JOIN clients c ON c.id = e.client_id AND c.kind = 'CUSTOMER'
      WHERE e.sent_date_pacific BETWEEN ${range.from}::date AND ${range.to}::date
      GROUP BY e.client_id`,
    weeksWithCalls(range),
    // how many clients we have any email for at all (the call-logs API only has Rasa's today)
    db.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT e.client_id)::int AS n FROM emails e JOIN clients c ON c.id = e.client_id AND c.kind = 'CUSTOMER'`,
  ]);
  const customers = [...lk.clients.values()].filter((c) => c.kind === "CUSTOMER");

  const callBy = new Map(calls.map((r) => [r.client_id!, toStats(addRow(emptyTally(), asRollup(r)))]));
  const mailBy = new Map(mail.map((m) => [m.client_id, m]));
  const orderBy = new Map<number, { orders: number; revenue: number }>();
  for (const o of orders) { const b = orderBy.get(o.clientId) ?? orderBy.set(o.clientId, { orders: 0, revenue: 0 }).get(o.clientId)!; b.orders++; b.revenue += o.total; }

  const weekly = weeklyRevenue(orders.map((o) => ({ date: o.date, total: o.total, groupId: o.clientId, subId: o.representativeId })));
  const totals = toStats(totalOf(calls));
  const email = mail.reduce((a, m) => ({ sent: a.sent + m.sent, opened: a.opened + m.opened, clicked: a.clicked + m.clicked, replied: a.replied + m.replied, bounced: a.bounced + m.bounced, unsubscribed: a.unsubscribed + m.unsubscribed }), { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, unsubscribed: 0 });

  const rows = customers.map((c) => {
    const k = callBy.get(c.id), m = mailBy.get(c.id), o = orderBy.get(c.id);
    return {
      clientId: c.id, name: c.name,
      dials: k?.calls ?? 0, connects: k?.connects ?? 0, meaningful: k?.meaningful ?? 0, mqls: k?.mql ?? 0,
      orders: o?.orders ?? 0, revenue: Math.round((o?.revenue ?? 0) * 100) / 100,
      emailsSent: m?.sent ?? 0, opened: m?.opened ?? 0, replied: m?.replied ?? 0,
    };
  });
  // a client is active when it has calls, orders or emails in these dates
  const byClient = rows.filter((r) => r.dials || r.orders || r.emailsSent).sort((a, b) => b.dials - a.dials || b.revenue - a.revenue);

  return {
    range,
    weeksOfCalls: new Set(weeksN).size,
    activeClients: { count: byClient.length, of: customers.length },
    revenue: { total: weekly.revenue, orders: weekly.orders, avgOrder: weekly.avgOrder, weeklyRunRate: weekly.runRate, weeks: weekly.weeks.length },
    calls: { dials: totals.calls, connects: totals.connects, meaningful: totals.meaningful, mql: totals.mql, mqlOver90: totals.mqlOver90, mqlUnder90: totals.mqlUnder90, answered: totals.answered, notAnswered: totals.notAnswered },
    emails: { ...email, delivered: email.sent - email.bounced, clientsWithData: coverage[0].n },
    byClient,
  };
}

// ───────────────────────── tables ─────────────────────────

type Node = { id: number; name: string; stats: ReturnType<typeof toStats>; children: { id: number; name: string; stats: ReturnType<typeof toStats> }[] };

async function table(range: Range, parent: "representative_id" | "client_id", child: "client_id" | "representative_id") {
  const [lk, rows] = await Promise.all([names(), sumRollups(range, [parent, child])]);
  const nameOf = (col: "client_id" | "representative_id", id: number) => (col === "client_id" ? lk.clients.get(id)?.name : lk.reps.get(id)?.name) ?? `#${id}`;
  const hidden = (col: "client_id" | "representative_id", id: number) => (col === "representative_id" ? !!lk.reps.get(id)?.internal : lk.clients.get(id)?.kind !== "CUSTOMER");
  const groups = new Map<number, { tally: Tally; kids: Map<number, Tally> }>();
  for (const r of rows) {
    const p = r[parent]!, c = r[child]!;
    if (hidden(parent, p) || hidden(child, c)) continue;
    const g = groups.get(p) ?? groups.set(p, { tally: emptyTally(), kids: new Map() }).get(p)!;
    addRow(g.tally, asRollup(r));
    addRow(g.kids.get(c) ?? g.kids.set(c, emptyTally()).get(c)!, asRollup(r));
  }
  const nodes: Node[] = [...groups].map(([id, g]) => ({
    id, name: nameOf(parent, id), stats: toStats(g.tally),
    children: [...g.kids].map(([cid, t]) => ({ id: cid, name: nameOf(child, cid), stats: toStats(t) })).sort((a, b) => b.stats.calls - a.stats.calls || a.name.localeCompare(b.name)),
  })).sort((a, b) => b.stats.calls - a.stats.calls || a.name.localeCompare(b.name));
  const total = [...groups.values()].reduce((t, g) => addRow(t, tallyToRow(g.tally)), emptyTally());
  return { nodes, total: toStats(total) };
}

const tallyToRow = (t: Tally): RollupRow => ({
  calls: t.calls, meaningful: t.meaningful, mqlOver90: t.mqlOver90, dMql: t.d.mql, dInterested: t.d.interested, dCallback: t.d.callback,
  dNotInterested: t.d.not_interested, dWrongNumber: t.d.wrong_number, dMqlFu: t.d.mql_fu, dDnc: t.d.dnc, dNoAnswer: t.d.no_answer,
  dBadNumber: t.d.bad_number, dVoicemail: t.d.voicemail, dMeeting: t.d.meeting, dBlank: t.d.blank, dOther: t.d.other,
});

/** The previous period is the same number of days straight before the range; there is none if it would start before the data does. */
export async function repTable(range: Range, dateMin: string) {
  const len = daysBetween(range.from, range.to) + 1;
  const prev: Range = { from: addDays(range.from, -len), to: addDays(range.from, -1) };
  const hasPrev = prev.from >= dateMin;
  const [t, prevRows] = await Promise.all([table(range, "representative_id", "client_id"), hasPrev ? sumRollups(prev, ["client_id"]) : Promise.resolve(null)]);
  const pick = (s: ReturnType<typeof toStats>) => ({ calls: s.calls, connects: s.connects, meaningful: s.meaningful });
  return {
    range, reps: t.nodes, total: t.total,
    kpis: { current: pick(t.total), previous: prevRows ? pick(toStats(totalOf(prevRows))) : null, previousRange: hasPrev ? prev : null },
    weeks: new Set(await weeksWithCalls(range)).size,
  };
}

export async function clientTable(range: Range) {
  const t = await table(range, "client_id", "representative_id");
  return { range, clients: t.nodes, total: t.total, weeks: new Set(await weeksWithCalls(range)).size };
}

async function weeksWithCalls(range: Range) {
  const rows = await db.$queryRaw<{ d: string }[]>`SELECT DISTINCT to_char(shift_date, 'YYYY-MM-DD') AS d FROM daily_rollups WHERE shift_date BETWEEN ${range.from}::date AND ${range.to}::date`;
  return rows.map((r) => mondayOf(r.d));
}

// ───────────────────────── profiles ─────────────────────────

/** `who` is the Representative or client the profile is for; `filterIds` narrow it by the other side (client chips or Representative chips). */
async function profile(kind: "rep" | "client", id: number, range: Range, filterIds: number[]) {
  const lk = await names();
  const self = kind === "rep" ? "representative_id" : "client_id";
  const other = kind === "rep" ? "client_id" : "representative_id";
  const mine = Prisma.sql`AND ${Prisma.raw(self)} = ${id}`;
  const rows = await sumRollups(range, [other], mine);
  const available = rows.map((r) => ({ id: r[other]!, calls: r.calls })).sort((a, b) => b.calls - a.calls);
  const selected = filterIds.filter((f) => available.some((a) => a.id === f)); // a filter with no calls in these dates is forgotten
  const used = selected.length ? rows.filter((r) => selected.includes(r[other]!)) : rows;
  const orders = await ordersIn(range, kind === "rep" ? { representativeId: id, ...(selected.length ? { clientId: { in: selected } } : {}) } : { clientId: id, ...(selected.length ? { representativeId: { in: selected } } : {}) });
  const recordings = await recordingsCount(kind, id, range, selected);
  const label = (n: number) => (kind === "rep" ? lk.clients.get(n)?.name : lk.reps.get(n)?.name) ?? `#${n}`;
  const entity = kind === "rep" ? lk.reps.get(id) : lk.clients.get(id);
  return {
    kind, id, name: entity?.name ?? `#${id}`, range,
    options: available.map((a) => ({ id: a.id, name: label(a.id), calls: a.calls })), // the chips
    selected,
    stats: toStats(totalOf(used)),
    revenue: orders.length ? { total: Math.round(orders.reduce((n, o) => n + o.total, 0) * 100) / 100, orders: orders.length } : null,
    recordings,
  };
}
export const repProfile = (id: number, range: Range, clientIds: number[]) => profile("rep", id, range, clientIds);
export const clientProfile = (id: number, range: Range, repIds: number[]) => profile("client", id, range, repIds);

// ───────────────────────── recordings ─────────────────────────

const connectList = Prisma.join(CONNECT_KEYS as readonly string[]);
const category = Prisma.sql`CASE WHEN c.disposition_key IN (${connectList}) THEN 'answered' WHEN c.disposition_key IS NULL OR c.disposition_key IN ('no_answer', 'bad_number') THEN 'not_answered' ELSE NULL END`;
const subKey = Prisma.sql`COALESCE(c.disposition_key, 'no_answer')`; // no disposition counts as No Answer
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

function recordingWhere(kind: "rep" | "client", id: number, range: Range, filterIds: number[], q: string) {
  const conds: Prisma.Sql[] = [
    Prisma.sql`a.status = 'CLIENT'`,
    Prisma.sql`c.shift_date BETWEEN ${range.from}::date AND ${range.to}::date`,
    Prisma.sql`c.recording_url LIKE 'https://%'`, // a link we can open
    kind === "rep" ? Prisma.sql`a.representative_id = ${id}` : Prisma.sql`a.client_id = ${id}`,
  ];
  if (filterIds.length) conds.push(kind === "rep" ? Prisma.sql`a.client_id IN (${Prisma.join(filterIds)})` : Prisma.sql`a.representative_id IN (${Prisma.join(filterIds)})`);
  // every word typed must appear in the prospect's name, company or title, or in the number dialled
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8).map((w) => (/^[\d()+.\-]+$/.test(w) ? w.replace(/\D/g, "") : w)).filter(Boolean);
  for (const w of words) conds.push(Prisma.sql`lower(concat_ws(' ', pm.name, pm.company, pm.title, pm.candidates, c.contact_no10)) LIKE ${`%${escapeLike(w)}%`}`);
  return Prisma.join(conds, " AND ");
}
const recordingFrom = Prisma.sql`FROM calls c JOIN call_attribution a ON a.call_id = c.id LEFT JOIN phone_matches pm ON pm.client_id = a.client_id AND pm.phone_no10 = c.contact_no10`;

async function recordingsCount(kind: "rep" | "client", id: number, range: Range, filterIds: number[]) {
  const r = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n ${recordingFrom} WHERE ${recordingWhere(kind, id, range, filterIds, "")}`;
  return r[0].n;
}

export type RecordingQuery = { range: Range; filterIds: number[]; q: string; category: "answered" | "not_answered" | null; sub: DispositionKey | null; limit: number };

export async function recordings(kind: "rep" | "client", id: number, o: RecordingQuery) {
  const settings = await loadSettings();
  const where = recordingWhere(kind, id, o.range, o.filterIds, o.q);
  const picks = [
    o.category ? Prisma.sql`${category} = ${o.category}` : Prisma.empty,
    o.category && o.sub ? Prisma.sql`${subKey} = ${o.sub}` : Prisma.empty,
  ].filter((p) => p !== Prisma.empty);
  const pickSql = picks.length ? Prisma.sql` AND ${Prisma.join(picks, " AND ")}` : Prisma.empty;
  const zone = settings.shiftZone;
  const [counts, items, lk] = await Promise.all([
    // counts for the buttons: after the search, before choosing Answered / Not answered
    db.$queryRaw<{ cat: string | null; sub: string; n: number }[]>`SELECT ${category} AS cat, ${subKey} AS sub, count(*)::int AS n ${recordingFrom} WHERE ${where} GROUP BY 1, 2`,
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c.occurred_at, to_char((c.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS ist_date,
             to_char((c.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'HH24:MI') AS ist_time,
             a.client_id, a.representative_id, c.duration_sec, c.disposition_key, c.recording_url, c.contact_no10,
             pm.kind AS m_kind, pm.name AS m_name, pm.company AS m_company, pm.title AS m_title, pm.candidates AS m_candidates
      ${recordingFrom} WHERE ${where}${pickSql}
      ORDER BY c.occurred_at DESC, c.id DESC LIMIT ${o.limit}`,
    names(),
  ]);
  const sub: Record<string, number> = {};
  let answered = 0, notAnswered = 0, all = 0;
  for (const c of counts) {
    all += c.n;
    if (c.cat === "answered") answered += c.n;
    if (c.cat === "not_answered") notAnswered += c.n;
    if (c.cat) sub[c.sub] = (sub[c.sub] ?? 0) + c.n;
  }
  const shown = items.length;
  const total = !o.category ? all : o.sub ? (sub[o.sub] ?? 0) : o.category === "answered" ? answered : notAnswered;
  return {
    total, counts: { all, answered, notAnswered, sub },
    items: items.map((r) => ({
      id: String(r.id),
      date: r.ist_date as string, time: r.ist_time as string, // as IST, the way the dashboards show times
      clientId: r.client_id as number, client: lk.clients.get(r.client_id as number)?.name ?? "",
      representativeId: r.representative_id as number, representative: lk.reps.get(r.representative_id as number)?.name ?? "",
      durationSec: r.duration_sec as number, disposition: r.disposition_key as string | null,
      url: r.recording_url as string, phone: r.contact_no10 as string | null,
      prospect: r.m_kind ? { kind: r.m_kind as "one" | "multiple", name: r.m_name as string | null, company: r.m_company as string | null, title: r.m_title as string | null, candidates: r.m_candidates as string | null } : { kind: "none" as const },
    })),
    hasMore: total > shown,
  };
}

// ───────────────────────── emails ─────────────────────────

export type EmailQuery = { range: Range; q: string; filter: "all" | "opened" | "replied" | "bounced"; limit: number };

export async function clientEmails(clientId: number, o: EmailQuery) {
  const base = Prisma.sql`e.client_id = ${clientId} AND e.sent AND e.sent_date_pacific BETWEEN ${o.range.from}::date AND ${o.range.to}::date`;
  const words = o.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const search = words.map((w) => Prisma.sql` AND lower(concat_ws(' ', e.to_name, e.to_email, e.to_company, e.subject)) LIKE ${`%${escapeLike(w)}%`}`);
  const searchSql = search.length ? Prisma.join(search, "") : Prisma.empty;
  const pick = { all: Prisma.empty, opened: Prisma.sql` AND e.opened`, replied: Prisma.sql` AND e.replied`, bounced: Prisma.sql` AND e.bounced` }[o.filter];
  const [summary, counts, items] = await Promise.all([
    // the summary is for the whole range; the buttons count after the search
    db.$queryRaw<{ sent: number; opened: number; replied: number; bounced: number; unsubscribed: number }[]>`
      SELECT count(*)::int AS sent, count(*) FILTER (WHERE e.opened)::int AS opened, count(*) FILTER (WHERE e.replied)::int AS replied,
             count(*) FILTER (WHERE e.bounced)::int AS bounced, count(*) FILTER (WHERE e.unsubscribed)::int AS unsubscribed
      FROM emails e WHERE ${base}`,
    db.$queryRaw<{ all: number; opened: number; replied: number; bounced: number }[]>`
      SELECT count(*)::int AS "all", count(*) FILTER (WHERE e.opened)::int AS opened, count(*) FILTER (WHERE e.replied)::int AS replied, count(*) FILTER (WHERE e.bounced)::int AS bounced
      FROM emails e WHERE ${base}${searchSql}`,
    db.$queryRaw<Record<string, unknown>[]>`
      SELECT e.id, e.subject, e.sent_at, e.to_name, e.to_email, e.to_company, e.step, e.sequence, e.contact_stage,
             e.opened, e.clicked, e.replied, e.bounced, e.unsubscribed
      FROM emails e WHERE ${base}${searchSql}${pick}
      ORDER BY e.sent_at DESC, e.id DESC LIMIT ${o.limit}`,
  ]);
  const total = counts[0][o.filter];
  return {
    summary: summary[0], counts: counts[0], total, hasMore: total > items.length,
    items: items.map((e) => ({
      id: e.id as string, subject: e.subject as string | null, sentAt: (e.sent_at as Date).toISOString(),
      toName: e.to_name as string | null, toEmail: e.to_email as string | null, toCompany: e.to_company as string | null,
      step: e.step as number | null, sequence: e.sequence as string | null, stage: e.contact_stage as string | null,
      opened: e.opened as boolean, clicked: e.clicked as boolean, replied: e.replied as boolean, bounced: e.bounced as boolean, unsubscribed: e.unsubscribed as boolean,
    })),
  };
}

/** One email in full. The reply is shown only when Apollo marks the email as replied (its reply field often holds a copy of the sent email). */
export async function emailDetail(id: string) {
  const e = await db.email.findUnique({ where: { id } });
  if (!e) return null;
  return {
    id: e.id, fromEmail: e.mailbox, toEmail: e.toEmail, subject: e.subject, sentAt: e.sentAt?.toISOString() ?? null,
    bodyHtml: sanitizeEmailHtml(e.bodyHtml), // the call-logs API sends no body yet
    replied: e.replied, replyText: e.replied ? (e.replyText ?? null) : null,
  };
}

// ───────────────────────── revenue ─────────────────────────

export async function revenueWeekly(by: "rep" | "client", range: Range) {
  const [lk, orders] = await Promise.all([names(), ordersIn(range)]);
  const w = weeklyRevenue(orders.map((o) => ({ date: o.date, total: o.total, groupId: by === "rep" ? o.representativeId : o.clientId, subId: by === "rep" ? o.clientId : o.representativeId })));
  const groupName = (id: number) => (by === "rep" ? lk.reps.get(id)?.name : lk.clients.get(id)?.name) ?? `#${id}`;
  const subName = (id: number) => (by === "rep" ? lk.clients.get(id)?.name : lk.reps.get(id)?.name) ?? `#${id}`;
  const named = (c: (typeof w.totals)[number]) => ({ ...c, by: c.by.map((b) => ({ ...b, name: subName(b.id) })) });
  return {
    by, range, weeks: w.weeks,
    rows: w.rows.map((r) => ({ id: r.id, name: groupName(r.id), total: r.total, cells: Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, named(c)])) })),
    totals: w.totals.map(named),
    summary: { revenue: w.revenue, orders: w.orders, avgOrder: w.avgOrder, runRate: w.runRate, groupsWithOrders: w.groups },
  };
}

// ───────────────────────── call timing and breaks ─────────────────────────

async function timedCalls(from: string, to: string, repId?: number) {
  const settings = await loadSettings();
  const rows = await db.$queryRaw<{ d: string; rep: number; client: number; t: number; secs: number }[]>`
    SELECT to_char(c.shift_date, 'YYYY-MM-DD') AS d, a.representative_id AS rep, a.client_id AS client,
           (EXTRACT(EPOCH FROM (((c.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE ${settings.shiftZone}) - c.shift_date::timestamp)) / 60.0)::float8 AS t,
           c.duration_sec AS secs
    FROM calls c JOIN call_attribution a ON a.call_id = c.id
    WHERE a.status = 'CLIENT' AND c.shift_date BETWEEN ${from}::date AND ${to}::date
      ${repId ? Prisma.sql`AND a.representative_id = ${repId}` : Prisma.empty}
    ORDER BY c.occurred_at`;
  return { settings, rows };
}

async function analyse(from: string, to: string, repId?: number) {
  const [{ settings, rows }, lk] = await Promise.all([timedCalls(from, to, repId), names()]);
  const scheduleFor = (clientId: number) => scheduleOf(settings.timing.clients[lk.clients.get(clientId)?.name ?? ""] ?? settings.timing.default);
  const byDayRep = new Map<string, TimedCall[]>();
  for (const r of rows) {
    const k = `${r.d}|${r.rep}`;
    (byDayRep.get(k) ?? byDayRep.set(k, []).get(k)!).push({ t: r.t, e: r.t + r.secs / 60, clientId: r.client });
  }
  const out = new Map<string, ReturnType<typeof analyzeRepDay> & { representativeId: number; name: string; clients: { id: number; name: string }[] }>();
  for (const [k, calls] of byDayRep) {
    const rep = Number(k.split("|")[1]);
    const a = analyzeRepDay(calls, scheduleFor, settings.timing);
    out.set(k, { ...a, representativeId: rep, name: lk.reps.get(rep)?.name ?? `#${rep}`, clients: a.clientIds.map((id) => ({ id, name: lk.clients.get(id)?.name ?? `#${id}` })) });
  }
  return { out, settings, lk };
}

/** Which days and weeks have calls, and who dialed in each week (for the pickers). */
export async function timingDays(range: Range) {
  const [lk, rows] = await Promise.all([names(), db.$queryRaw<{ d: string; rep: number; n: number }[]>`
    SELECT to_char(c.shift_date, 'YYYY-MM-DD') AS d, a.representative_id AS rep, count(*)::int AS n
    FROM calls c JOIN call_attribution a ON a.call_id = c.id
    WHERE a.status = 'CLIENT' AND c.shift_date BETWEEN ${range.from}::date AND ${range.to}::date GROUP BY 1, 2 ORDER BY 1`]);
  const days = [...new Set(rows.map((r) => r.d))].sort();
  const weeks = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const m = weeks.get(mondayOf(r.d)) ?? weeks.set(mondayOf(r.d), new Map()).get(mondayOf(r.d))!;
    m.set(r.rep, (m.get(r.rep) ?? 0) + r.n);
  }
  return {
    days,
    weeks: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([monday, reps]) => ({
      monday, representatives: [...reps].map(([id, dials]) => ({ id, name: lk.reps.get(id)?.name ?? `#${id}`, dials })).sort((a, b) => a.name.localeCompare(b.name)),
    })),
  };
}

export async function timingDay(date: string) {
  const { out, settings } = await analyse(date, date);
  const reps = [...out.values()].sort((a, b) => a.first - b.first);
  return { date, reps, summary: summarize(reps), settings: settings.timing };
}

export async function timingWeek(monday: string, repId: number) {
  const to = addDays(monday, 6);
  const { out, settings, lk } = await analyse(monday, to, repId);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => ({ date: d, day: out.get(`${d}|${repId}`) ?? null }));
  const worked = days.filter((d) => d.day).map((d) => d.day!);
  const dials = worked.reduce((n, d) => n + d.calls, 0);
  return { week: monday, representative: { id: repId, name: lk.reps.get(repId)?.name ?? `#${repId}` }, days, summary: { ...summarize(worked), dials, daysDialed: worked.length }, settings: settings.timing };
}
