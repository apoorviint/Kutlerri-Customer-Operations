import { Router } from "express";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { lastSyncRun, isSyncing } from "../services/sync.js";

export const statsRouter = Router();

const DAY_MS = 86_400_000;
const ALLOWED_DAYS = [7, 30, 90, 365];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One entry per calendar day in the window, zero-filled, so charts have a continuous axis. */
function fillDays(rows: { day: string; count: number }[], since: Date, days: number) {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  return Array.from({ length: days }, (_, i) => {
    const day = iso(new Date(since.getTime() + i * DAY_MS));
    return { day, count: byDay.get(day) ?? 0 };
  });
}

statsRouter.get("/", async (req, res) => {
  const requested = Number(req.query.days);
  const days = ALLOWED_DAYS.includes(requested) ? requested : 30;
  // window = today and the previous (days - 1) days, in UTC
  const today = new Date(iso(new Date()) + "T00:00:00Z");
  const since = new Date(today.getTime() - (days - 1) * DAY_MS);

  const [callTotals, callsByDay, callsByAgent, emailTotals, emailsByDay, emailsBySequence, emailsByStage, last] = await Promise.all([
    db.$queryRaw<{ total: number; connected: number; avg: number | null; seconds: number }[]>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "duration" > 0)::int AS connected,
             AVG("duration") FILTER (WHERE "duration" > 0)::float AS avg,
             COALESCE(SUM("duration"), 0)::int AS seconds
      FROM "Call" WHERE "startedAt" >= ${since}`,
    db.$queryRaw<{ day: string; count: number }[]>`
      SELECT to_char("startedAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "Call" WHERE "startedAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<{ agent: string; count: number; connected: number; avg: number | null }[]>`
      SELECT COALESCE("agentName", 'Unknown') AS agent, COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE "duration" > 0)::int AS connected,
             AVG("duration") FILTER (WHERE "duration" > 0)::float AS avg
      FROM "Call" WHERE "startedAt" >= ${since} GROUP BY 1 ORDER BY count DESC LIMIT 15`,
    db.$queryRaw<{ sent: number; opened: number; clicked: number; replied: number; bounced: number; unsubscribed: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "sent")::int AS sent,
             COUNT(*) FILTER (WHERE "open")::int AS opened,
             COUNT(*) FILTER (WHERE "click")::int AS clicked,
             COUNT(*) FILTER (WHERE "replied")::int AS replied,
             COUNT(*) FILTER (WHERE "bounce")::int AS bounced,
             COUNT(*) FILTER (WHERE "unsubscribe")::int AS unsubscribed
      FROM "Email" WHERE "sentAt" >= ${since}`,
    db.$queryRaw<{ day: string; count: number }[]>`
      SELECT to_char("sentAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM "Email" WHERE "sentAt" >= ${since} AND "sent" GROUP BY 1`,
    db.$queryRaw<{ sequence: string; sent: number; opened: number; replied: number; bounced: number }[]>`
      SELECT COALESCE("sequence", 'Unknown') AS sequence,
             COUNT(*) FILTER (WHERE "sent")::int AS sent,
             COUNT(*) FILTER (WHERE "open")::int AS opened,
             COUNT(*) FILTER (WHERE "replied")::int AS replied,
             COUNT(*) FILTER (WHERE "bounce")::int AS bounced
      FROM "Email" WHERE "sentAt" >= ${since} GROUP BY 1 ORDER BY sent DESC LIMIT 15`,
    db.$queryRaw<{ stage: string; count: number }[]>`
      SELECT COALESCE("contactStage", 'Unknown') AS stage, COUNT(*)::int AS count
      FROM "Email" WHERE "sentAt" >= ${since} GROUP BY 1 ORDER BY count DESC`,
    lastSyncRun(),
  ]);

  const c = callTotals[0];
  const e = emailTotals[0];
  res.json({
    range: { days, since: iso(since) },
    calls: {
      total: c.total,
      connected: c.connected,
      avgDurationSec: c.avg,
      totalSeconds: c.seconds,
      byDay: fillDays(callsByDay, since, days),
      byAgent: callsByAgent,
    },
    emails: {
      ...e,
      byDay: fillDays(emailsByDay, since, days),
      bySequence: emailsBySequence,
      byStage: emailsByStage,
    },
    sync: {
      running: isSyncing(),
      last: last && { ok: last.ok, startedAt: last.startedAt, finishedAt: last.finishedAt, error: last.error, calls: last.calls, emails: last.emails },
    },
  });
});

// Filter options for the tables
statsRouter.get("/filters", async (_req, res) => {
  const [agents, sequences, stages] = await Promise.all([
    db.$queryRaw<{ v: string }[]>(Prisma.sql`SELECT DISTINCT "agentName" AS v FROM "Call" WHERE "agentName" IS NOT NULL ORDER BY 1`),
    db.$queryRaw<{ v: string }[]>(Prisma.sql`SELECT DISTINCT "sequence" AS v FROM "Email" WHERE "sequence" IS NOT NULL ORDER BY 1`),
    db.$queryRaw<{ v: string }[]>(Prisma.sql`SELECT DISTINCT "contactStage" AS v FROM "Email" WHERE "contactStage" IS NOT NULL ORDER BY 1`),
  ]);
  res.json({ agents: agents.map((r) => r.v), sequences: sequences.map((r) => r.v), stages: stages.map((r) => r.v) });
});
