import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { walkCalls, walkEmails, type CallRow, type EmailRow } from "./callLogsApi.js";

const OVERLAP_DAYS = 2; // re-fetch recent days so late changes (email opens, replies) are picked up

let running: Promise<SyncResult> | null = null;

export type SyncResult = { ok: boolean; full: boolean; calls: number; emails: number; error?: string; warning?: string };

const dayString = (d: Date) => d.toISOString().slice(0, 10);

function dedupe<T extends { id: string }>(rows: T[]) {
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

async function upsertCalls(rows: CallRow[]) {
  rows = dedupe(rows);
  if (!rows.length) return;
  const values = rows.map(
    (r) => Prisma.sql`(${r.id}, ${r.contactNo}, ${r.justcallNo}, ${r.justcallNoName}, ${r.agentName}, ${r.recordingUrl}, ${r.duration}, ${r.startedAt}, ${r.disposition}, ${r.syncedAt})`,
  );
  await db.$executeRaw`
    INSERT INTO "Call" ("id","contactNo","justcallNo","justcallNoName","agentName","recordingUrl","duration","startedAt","disposition","syncedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("id") DO UPDATE SET
      "contactNo" = EXCLUDED."contactNo", "justcallNo" = EXCLUDED."justcallNo", "justcallNoName" = EXCLUDED."justcallNoName",
      "agentName" = EXCLUDED."agentName", "recordingUrl" = EXCLUDED."recordingUrl", "duration" = EXCLUDED."duration",
      "startedAt" = EXCLUDED."startedAt", "disposition" = EXCLUDED."disposition", "syncedAt" = EXCLUDED."syncedAt"`;
}

async function upsertEmails(rows: EmailRow[]) {
  rows = dedupe(rows);
  if (!rows.length) return;
  const values = rows.map(
    (r) => Prisma.sql`(${r.id}, ${r.sequence}, ${r.sequenceId}, ${r.step}, ${r.template}, ${r.fromEmail}, ${r.toEmail}, ${r.fromName}, ${r.toName}, ${r.subject}, ${r.sentAt}, ${r.scheduledAt}, ${r.sent}, ${r.bounce}, ${r.open}, ${r.click}, ${r.unsubscribe}, ${r.replied}, ${r.contactId}, ${r.accountId}, ${r.toCompany}, ${r.contactStage}, ${r.syncedAt})`,
  );
  await db.$executeRaw`
    INSERT INTO "Email" ("id","sequence","sequenceId","step","template","fromEmail","toEmail","fromName","toName","subject","sentAt","scheduledAt","sent","bounce","open","click","unsubscribe","replied","contactId","accountId","toCompany","contactStage","syncedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("id") DO UPDATE SET
      "sequence" = EXCLUDED."sequence", "sequenceId" = EXCLUDED."sequenceId", "step" = EXCLUDED."step", "template" = EXCLUDED."template",
      "fromEmail" = EXCLUDED."fromEmail", "toEmail" = EXCLUDED."toEmail", "fromName" = EXCLUDED."fromName", "toName" = EXCLUDED."toName",
      "subject" = EXCLUDED."subject", "sentAt" = EXCLUDED."sentAt", "scheduledAt" = EXCLUDED."scheduledAt", "sent" = EXCLUDED."sent",
      "bounce" = EXCLUDED."bounce", "open" = EXCLUDED."open", "click" = EXCLUDED."click", "unsubscribe" = EXCLUDED."unsubscribe",
      "replied" = EXCLUDED."replied", "contactId" = EXCLUDED."contactId", "accountId" = EXCLUDED."accountId",
      "toCompany" = EXCLUDED."toCompany", "contactStage" = EXCLUDED."contactStage", "syncedAt" = EXCLUDED."syncedAt"`;
}

/** Where an incremental sync starts: a couple of days before the newest stored row, or everything if the table is empty. */
async function startDay(newest: Date | null | undefined) {
  if (!newest) return null;
  return dayString(new Date(newest.getTime() - OVERLAP_DAYS * 86_400_000));
}

async function execute(): Promise<SyncResult> {
  const [newestCall, newestEmail] = await Promise.all([
    db.call.aggregate({ _max: { startedAt: true } }),
    db.email.aggregate({ _max: { sentAt: true } }),
  ]);
  const callFrom = await startDay(newestCall._max.startedAt);
  const emailFrom = await startDay(newestEmail._max.sentAt);
  const full = callFrom === null || emailFrom === null;

  const run = await db.syncRun.create({ data: { full } });
  try {
    const c = await walkCalls(callFrom, upsertCalls);
    const e = await walkEmails(emailFrom, upsertEmails);
    // Still short after the retries: keep what we have, but say so instead of reporting a clean sync.
    const short = [c.count < c.total && `calls ${c.count}/${c.total}`, e.count < e.total && `emails ${e.count}/${e.total}`].filter(Boolean);
    const warning = short.length ? `Some rows could not be fetched (${short.join(", ")}); the next sync will retry.` : null;
    if (warning) console.warn(warning);
    await db.syncRun.update({
      where: { id: run.id },
      data: { ok: true, calls: c.count, emails: e.count, error: warning, finishedAt: new Date() },
    });
    return { ok: true, full, calls: c.count, emails: e.count, ...(warning && { warning }) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.syncRun.update({ where: { id: run.id }, data: { ok: false, error, finishedAt: new Date() } });
    return { ok: false, full, calls: 0, emails: 0, error };
  }
}

/** Starts a sync unless one is already running; concurrent callers share the same run. */
export function startSync() {
  if (!running) running = execute().finally(() => (running = null));
  return running;
}

export const isSyncing = () => running !== null;

export async function lastSyncRun() {
  return db.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
}
