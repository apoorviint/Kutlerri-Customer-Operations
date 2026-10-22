import { Router } from "express";
import { DateTime } from "luxon";
import { db } from "../db.js";
import { requireUser } from "../auth.js";
import { isSyncing } from "../services/jobsState.js";
import { loadSettings } from "../services/settings.js";

export const statusRouter = Router();

const STALE_HOURS = 2;

statusRouter.get("/", requireUser, async (_req, res) => {
  const settings = await loadSettings();
  const [calls, emails, noRep, callRuns, emailRuns, tzRules] = await Promise.all([
    db.$queryRaw<{ total: number; newest: Date | null; first_shift: string | null; last_shift: string | null; unmapped_agents: number }[]>`
      SELECT count(*)::int AS total, max(c.occurred_at) AS newest,
             to_char(min(c.shift_date), 'YYYY-MM-DD') AS first_shift, to_char(max(c.shift_date), 'YYYY-MM-DD') AS last_shift,
             count(*) FILTER (WHERE c.agent_id IS NULL)::int AS unmapped_agents
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
  ]);
  const lastOk = async (source: string) => db.syncRun.findFirst({ where: { source, status: { in: ["ok", "warning"] } }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } });
  const [okCalls, okEmails] = await Promise.all([lastOk("calls"), lastOk("emails")]);

  const warnings: string[] = [];
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

  res.json({
    now: new Date().toISOString(),
    showingFrom: settings.backfillStart,
    calls: {
      total: calls[0].total, newestCallAt: calls[0].newest, firstShiftDate: calls[0].first_shift, lastShiftDate: calls[0].last_shift,
      lastSyncedAt: okCalls?.finishedAt ?? null, lastRun: callRuns[0] ?? null,
    },
    emails: {
      total: emails[0].total, newestSentAt: emails[0].newest, withoutClient: emails[0].unmapped, internal: emails[0].internal,
      lastSyncedAt: okEmails?.finishedAt ?? null, lastRun: emailRuns[0] ?? null,
    },
    timezoneRules: tzRules,
    syncing: await isSyncing(),
    warnings,
  });
});
