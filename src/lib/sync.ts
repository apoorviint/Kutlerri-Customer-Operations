import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { fetchCalls, fetchMails } from "./api-client";

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function runSync() {
  const run = await db.syncRun.create({ data: {} });
  try {
    const [calls, mails] = await Promise.all([fetchCalls(), fetchMails()]);
    for (const c of calls) {
      const data = { ...c, payload: json(c.payload), syncedAt: new Date() };
      await db.call.upsert({ where: { externalId: c.externalId }, create: data, update: data });
    }
    for (const m of mails) {
      const data = { ...m, payload: json(m.payload), syncedAt: new Date() };
      await db.mail.upsert({ where: { externalId: m.externalId }, create: data, update: data });
    }
    await db.syncRun.update({
      where: { id: run.id },
      data: { ok: true, calls: calls.length, mails: mails.length, finishedAt: new Date() },
    });
    return { ok: true, calls: calls.length, mails: mails.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.syncRun.update({ where: { id: run.id }, data: { ok: false, error, finishedAt: new Date() } });
    return { ok: false, calls: 0, mails: 0, error };
  }
}
