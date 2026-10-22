import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { config } from "../config.js";
import { addDays, todayIn, ZONES } from "../rules/time.js";
import { ingestCallsWindow, loadAgentIds, type WindowResult } from "./ingestCalls.js";
import { apiTotal } from "./callLogsApi.js";
import { ingestEmailsWindow } from "./ingestEmails.js";
import { attributeAndRollup, rebuildRollups } from "./attribution.js";
import { recomputeCallTimes, recomputeEmailClients } from "./recompute.js";
import { loadEmailRules, loadTzRules } from "./referenceData.js";
import { loadSettings } from "./settings.js";
import { clearCache } from "./cache.js";

export const JOB_NAMES = ["calls", "emails", "recompute-call-times", "recompute-email-clients", "attribute-calls", "rebuild-rollups"] as const;
export type JobName = (typeof JOB_NAMES)[number];

export type JobOptions = {
  from?: string; // YYYY-MM-DD. The provider's dates for calls and emails; shift days for attribute-calls and rebuild-rollups
  to?: string;
  triggeredBy?: string;
};

const OVERLAP_DAYS = 2; // re-read the last couple of days so late changes (email opens, replies) are picked up
const LOCK_MINUTES = 45;
const owner = `${process.pid}-${randomUUID().slice(0, 8)}`;

// ───────────── lock: the same job never runs twice at once ─────────────

async function acquireLock(name: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    INSERT INTO job_locks (name, locked_at, locked_by) VALUES (${name}, timezone('UTC', now()), ${owner})
    ON CONFLICT (name) DO UPDATE SET locked_at = timezone('UTC', now()), locked_by = ${owner}
    WHERE job_locks.locked_at < timezone('UTC', now()) - make_interval(mins => ${LOCK_MINUTES}::int)
    RETURNING name`;
  return rows.length > 0;
}
const touchLock = (name: string) => db.$executeRaw`UPDATE job_locks SET locked_at = timezone('UTC', now()) WHERE name = ${name} AND locked_by = ${owner}`;
const releaseLock = (name: string) => db.$executeRaw`DELETE FROM job_locks WHERE name = ${name} AND locked_by = ${owner}`;

// ───────────── the jobs ─────────────

type Totals = { fetched: number; inserted: number; updated: number; unchanged: number; skipped: number };
type Outcome = { totals: Totals; warnings: string[]; details: Record<string, unknown>; from?: string; to?: string; kind: string };

const zero = (): Totals => ({ fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0 });

function addWindow(t: Totals, w: WindowResult) {
  t.fetched += w.fetched; t.inserted += w.inserted; t.updated += w.updated; t.unchanged += w.unchanged; t.skipped += w.skipped;
}

/** Day-by-day so a long catch-up can report progress and be restarted from any day. */
async function walkDays(
  name: JobName, runId: string, from: string, to: string,
  each: (day: string) => Promise<WindowResult>,
): Promise<Outcome> {
  const totals = zero();
  const warnings: string[] = [];
  const unknown: Record<string, number> = {};
  let passesOver1 = 0;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  for (const [i, day] of days.entries()) {
    const w = await each(day);
    addWindow(totals, w);
    if (w.passes > 1) passesOver1++;
    if (w.distinct < w.total) warnings.push(`${day}: received ${w.distinct} of ${w.total} rows even after retrying`);
    if (w.skipped) warnings.push(`${day}: ${w.skipped} rows could not be read (${w.errors[0] ?? "unknown reason"})`);
    for (const [k, n] of Object.entries(w.unknownDispositions)) unknown[k] = (unknown[k] ?? 0) + n;
    await touchLock(name);
    await db.syncRun.update({ where: { id: runId }, data: { ...totals, details: { lastCompletedDay: day, daysDone: i + 1, daysTotal: days.length } } });
  }
  if (Object.keys(unknown).length) warnings.push(`Unrecognised dispositions kept as "no disposition": ${JSON.stringify(unknown)}`);
  return { totals, warnings: warnings.slice(0, 20), details: { daysTotal: days.length, daysWithRetries: passesOver1, unknownDispositions: unknown }, from, to, kind: "" };
}

async function runCalls(runId: string, opts: JobOptions): Promise<Outcome> {
  const settings = await loadSettings();
  const ctx = { settings, rules: await loadTzRules(), agentIds: await loadAgentIds() };
  const newest = await db.$queryRaw<{ d: string | null }[]>`SELECT to_char(max(local_date), 'YYYY-MM-DD') AS d FROM calls`;
  const today = todayIn(ZONES.eastern);
  // an explicit range, or "from a couple of days before the newest stored call" (everything since the start date if empty)
  const from = opts.from ?? (newest[0].d ? addDays(newest[0].d, -OVERLAP_DAYS) : settings.backfillStart);
  const to = opts.to ?? addDays(today, 1);
  let start = from < settings.backfillStart ? settings.backfillStart : from;
  // catch-up: if the API holds more rows since the start date than we do (older rows that appeared late), read everything again
  let catchUp: Record<string, number> | null = null;
  if (!opts.from && newest[0].d && start > settings.backfillStart) {
    const [mine] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM calls WHERE local_date >= ${settings.backfillStart}::date AND local_date <= ${to}::date`;
    const theirs = await apiTotal("/v1/calls", settings.backfillStart, to);
    if (theirs > mine.n) { catchUp = { stored: mine.n, api: theirs }; start = settings.backfillStart; }
  }
  const o = await walkDays("calls", runId, start, to, (day) => ingestCallsWindow(ctx, day, day));
  o.kind = opts.from ? "range" : newest[0].d ? "incremental" : "backfill";
  // a call's shift day is the day it was logged or the day before, so refresh one day either side
  if (catchUp) o.details.catchUp = catchUp;
  o.details.attribution = await attributeAndRollup(addDays(start, -1), addDays(to, 1));
  return o;
}

async function runEmails(runId: string, opts: JobOptions): Promise<Outcome> {
  const settings = await loadSettings();
  const ctx = { settings, rules: await loadEmailRules() };
  const newest = await db.$queryRaw<{ d: string | null }[]>`SELECT to_char(max(sent_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS d FROM emails`;
  const from = opts.from ?? (newest[0].d ? addDays(newest[0].d, -OVERLAP_DAYS) : settings.backfillStart);
  const to = opts.to ?? addDays(todayIn(ZONES.eastern), 1);
  let start = from < settings.backfillStart ? settings.backfillStart : from;
  // catch-up: other clients' older emails may appear in the API later; if it holds more than we do, read everything again
  let catchUp: Record<string, number> | null = null;
  if (!opts.from && newest[0].d && start > settings.backfillStart) {
    const [mine] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM emails WHERE sent_date_pacific >= ${settings.backfillStart}::date AND sent_date_pacific <= ${to}::date`;
    const theirs = await apiTotal("/v1/emails", settings.backfillStart, to);
    if (theirs > mine.n) { catchUp = { stored: mine.n, api: theirs }; start = settings.backfillStart; }
  }
  const o = await walkDays("emails", runId, start, to, (day) => ingestEmailsWindow(ctx, day, day));
  o.kind = opts.from ? "range" : newest[0].d ? "incremental" : "backfill";
  if (catchUp) o.details.catchUp = catchUp;
  return o;
}

async function runRecomputeCalls(runId: string, opts: JobOptions): Promise<Outcome> {
  const r = await recomputeCallTimes(opts.from, opts.to, (done) => void db.syncRun.update({ where: { id: runId }, data: { fetched: done } }).catch(() => {}));
  const attribution = r.changed ? await attributeAndRollup(opts.from ? addDays(opts.from, -2) : undefined, opts.to ? addDays(opts.to, 2) : undefined) : null;
  return { totals: { ...zero(), fetched: r.scanned, updated: r.changed }, warnings: [], details: { ...r, attribution }, from: opts.from, to: opts.to, kind: "range" };
}

async function runAttribute(runId: string, opts: JobOptions): Promise<Outcome> {
  const r = await attributeAndRollup(opts.from, opts.to, (done) => void db.syncRun.update({ where: { id: runId }, data: { fetched: done } }).catch(() => {}));
  return { totals: { ...zero(), fetched: r.attribution.scanned, updated: r.attribution.changed }, warnings: [], details: r, from: opts.from, to: opts.to, kind: "range" };
}

async function runRollups(opts: JobOptions): Promise<Outcome> {
  const r = await rebuildRollups(opts.from, opts.to);
  return { totals: { ...zero(), updated: r.rows }, warnings: [], details: r, from: opts.from, to: opts.to, kind: "range" };
}

async function runRecomputeEmails(): Promise<Outcome> {
  const r = await recomputeEmailClients();
  return { totals: { ...zero(), fetched: r.scanned, updated: r.changed }, warnings: [], details: r, kind: "range" };
}

// ───────────── running a job ─────────────

export type JobResult = { started: boolean; runId?: string; status?: string; reason?: string };

export async function runJob(name: JobName, opts: JobOptions = {}): Promise<JobResult> {
  if (!(await acquireLock(name))) return { started: false, reason: `${name} is already running` };
  const run = await db.syncRun.create({
    data: {
      source: name, kind: opts.from ? "range" : "incremental", triggeredBy: opts.triggeredBy ?? "schedule",
      windowFrom: opts.from ? new Date(opts.from) : null, windowTo: opts.to ? new Date(opts.to) : null,
    },
  });
  try {
    const o =
      name === "calls" ? await runCalls(run.id, opts)
      : name === "emails" ? await runEmails(run.id, opts)
      : name === "recompute-call-times" ? await runRecomputeCalls(run.id, opts)
      : name === "attribute-calls" ? await runAttribute(run.id, opts)
      : name === "rebuild-rollups" ? await runRollups(opts)
      : await runRecomputeEmails();
    const status = o.warnings.length ? "warning" : "ok";
    await db.syncRun.update({
      where: { id: run.id },
      data: {
        status, finishedAt: new Date(), kind: o.kind || undefined, ...o.totals,
        windowFrom: o.from ? new Date(o.from) : undefined, windowTo: o.to ? new Date(o.to) : undefined,
        error: o.warnings.length ? o.warnings.join("\n").slice(0, 2000) : null,
        details: JSON.parse(JSON.stringify(o.details)),
      },
    });
    return { started: true, runId: run.id, status };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[job ${name}] failed:`, error);
    await db.syncRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), error: error.slice(0, 2000) } });
    return { started: true, runId: run.id, status: "failed", reason: error };
  } finally {
    clearCache(); // whatever the run changed, the dashboards must not show an older answer
    await releaseLock(name);
  }
}

/** Marks runs left "running" by a crashed process as failed, and frees their locks. Called once at start-up. */
export async function cleanUpAfterCrash() {
  await db.syncRun.updateMany({ where: { status: "running" }, data: { status: "failed", finishedAt: new Date(), error: "Interrupted (the service stopped while this was running)" } });
  // a "replace" upload that stopped half way must give the earlier databases back
  const stuck = (await db.prospectBatch.findMany({ where: { status: "processing" }, select: { id: true } })).map((b) => b.id);
  if (stuck.length) await db.prospectBatch.updateMany({ where: { supersededById: { in: stuck } }, data: { supersededById: null } });
  await db.prospectBatch.updateMany({ where: { status: "processing" }, data: { status: "failed", finishedAt: new Date(), error: "Interrupted (the service stopped while this was being read). Upload the file again." } });
  await db.jobLock.deleteMany({});
}

// ───────────── timers (local development; production uses Cloud Scheduler) ─────────────

export function startScheduler() {
  if (!config.enableScheduler) return () => {};
  const every = (minutes: number, name: JobName) => setInterval(() => void runJob(name, { triggeredBy: "schedule" }), minutes * 60_000);
  const timers = [every(15, "calls"), every(30, "emails")];
  setTimeout(() => void runJob("calls", { triggeredBy: "schedule" }), 10_000);
  setTimeout(() => void runJob("emails", { triggeredBy: "schedule" }), 20_000);
  return () => timers.forEach(clearInterval);
}
