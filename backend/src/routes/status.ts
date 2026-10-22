import { Router } from "express";
import { DateTime } from "luxon";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { isSyncing } from "../services/jobsState.js";
import { loadSettings } from "../services/settings.js";

export const statusRouter = Router();

const STALE_HOURS = 2;
const fourDigits = (p: string | null) => (p ? `…${p.slice(-4)}` : "(no line)");

statusRouter.get("/", requireUser, async (_req, res) => {
  const settings = await loadSettings();
  const since = settings.backfillStart;
  const [calls, emails, noRep, callRuns, emailRuns, tzRules, attribution, unassigned, fallback, coverage] = await Promise.all([
    db.$queryRaw<{ total: number; newest: Date | null; first_shift: string | null; last_shift: string | null }[]>`
      SELECT count(*)::int AS total, max(c.occurred_at) AS newest,
             to_char(min(c.shift_date), 'YYYY-MM-DD') AS first_shift, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last_shift
      FROM calls c`,
    db.$queryRaw<{ total: number; newest: Date | null; unmapped: number; internal: number }[]>`
      SELECT count(*)::int AS total, max(e.sent_at) AS newest,
             count(*) FILTER (WHERE e.client_id IS NULL)::int AS unmapped,
             count(*) FILTER (WHERE cl.kind = 'INTERNAL')::int AS internal
      FROM emails e LEFT JOIN clients cl ON cl.id = e.client_id`,
    db.agent.count({ where: { representativeId: null } }),
    db.syncRun.findMany({ where: { source: "calls" }, orderBy: { startedAt: "desc" }, take: 1 }),
    db.syncRun.findMany({ where: { source: "emails" }, orderBy: { startedAt: "desc" }, take: 1 }),
    db.callTimezoneRule.count(),
    db.$queryRaw<{ status: string; n: number }[]>`
      SELECT a.status, count(*)::int AS n FROM call_attribution a JOIN calls c ON c.id = a.call_id
      WHERE c.shift_date >= ${since}::date GROUP BY 1`,
    db.$queryRaw<{ line: string | null; n: number; last: string }[]>`
      SELECT c.justcall_no10 AS line, count(*)::int AS n, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last
      FROM calls c JOIN call_attribution a ON a.call_id = c.id
      WHERE a.status = 'UNASSIGNED' AND c.shift_date >= ${since}::date GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
    db.$queryRaw<{ n: number; lines: string[] | null }[]>`
      SELECT count(*)::int AS n, array_agg(DISTINCT c.justcall_no10) AS lines
      FROM calls c JOIN call_attribution a ON a.call_id = c.id
      WHERE a.reason = 'agent-fallback' AND c.shift_date >= ${since}::date`,
    db.$queryRaw<{ through: string | null; uploads: number }[]>`
      SELECT to_char(max(la.valid_to), 'YYYY-MM-DD') AS through, count(DISTINCT la.upload_id)::int AS uploads
      FROM line_assignments la JOIN assignment_uploads u ON u.id = la.upload_id
      WHERE la.superseded_by_upload_id IS NULL AND u.status = 'committed' AND la.priority > 0`,
  ]);
  const lastOk = async (source: string) => db.syncRun.findFirst({ where: { source, status: { in: ["ok", "warning"] } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  const [okCalls, okEmails] = await Promise.all([lastOk("calls"), lastOk("emails")]);

  const byStatus = Object.fromEntries(attribution.map((a) => [a.status, a.n])) as Record<string, number>;
  const warnings: string[] = [];
  const notices: string[] = [];
  for (const [name, run] of [["Calls", callRuns[0]], ["Emails", emailRuns[0]]] as const) {
    if (run?.status === "failed") warnings.push(`${name}: the last sync failed (${run.error ?? "no details"})`);
    if (run?.status === "warning") warnings.push(`${name}: the last sync finished with warnings`);
  }
  // no new calls for more than 2 hours while a shift is running (5 PM to 5 AM IST)
  const nowIst = DateTime.now().setZone(settings.shiftZone);
  const inShift = nowIst.hour >= settings.shiftStartHour || nowIst.hour < 5;
  const newest = calls[0].newest;
  if (inShift && newest && (Date.now() - newest.getTime()) / 3_600_000 > STALE_HOURS) {
    warnings.push(`No new calls for ${Math.floor((Date.now() - newest.getTime()) / 3_600_000)} hours during a shift`);
  }
  if (noRep) warnings.push(`${noRep} agent(s) are not mapped to a Representative yet`);
  if (emails[0].unmapped) warnings.push(`${emails[0].unmapped} email(s) could not be matched to a client (unknown sender domain)`);

  const through = coverage[0].through;
  if (byStatus.UNASSIGNED) {
    const lines = unassigned.map((u) => `${fourDigits(u.line)} (${u.n})`).join(", ");
    warnings.push(
      `${byStatus.UNASSIGNED.toLocaleString()} calls have no client yet because their phone line is not on the who-dialed-for-whom sheet for that day` +
      `${through ? ` (the sheet covers up to ${through})` : ""}. Busiest lines: ${lines}. Upload the next sheet to include them.`,
    );
  }
  if (byStatus.CONFLICT) warnings.push(`${byStatus.CONFLICT.toLocaleString()} calls are on a shared line and could not be decided by their agent`);
  if (fallback[0].n) {
    notices.push(
      `${fallback[0].n.toLocaleString()} calls were counted for the agent's Representative because their line is not on the sheet ` +
      `(${(fallback[0].lines ?? []).slice(0, 8).map(fourDigits).join(", ")}${(fallback[0].lines?.length ?? 0) > 8 ? "…" : ""}). Add those lines to the sheet to make this explicit.`,
    );
  }

  res.json({
    now: new Date().toISOString(),
    showingFrom: since,
    calls: {
      total: calls[0].total, newestCallAt: calls[0].newest, firstShiftDate: calls[0].first_shift, lastShiftDate: calls[0].last_shift,
      lastSyncedAt: okCalls?.finishedAt ?? null, lastRun: callRuns[0] ?? null,
      byClient: byStatus.CLIENT ?? 0, internal: byStatus.INTERNAL ?? 0, unassigned: byStatus.UNASSIGNED ?? 0, undecided: byStatus.CONFLICT ?? 0,
    },
    emails: {
      total: emails[0].total, newestSentAt: emails[0].newest, withoutClient: emails[0].unmapped, internal: emails[0].internal,
      lastSyncedAt: okEmails?.finishedAt ?? null, lastRun: emailRuns[0] ?? null,
    },
    assignments: { coveredThrough: through, uploads: coverage[0].uploads, agentFallback: settings.agentFallback },
    timezoneRules: tzRules,
    syncing: await isSyncing(),
    warnings,
    notices,
  });
});
