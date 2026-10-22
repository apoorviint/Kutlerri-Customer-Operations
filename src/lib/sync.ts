import { db } from "./db";
import { fetchRecords } from "./api-client";
import type { Prisma } from "@prisma/client";

export async function runSync() {
  const run = await db.syncRun.create({ data: {} });
  try {
    const items = await fetchRecords();
    for (const it of items) {
      const data = { ...it, payload: it.payload as Prisma.InputJsonValue, syncedAt: new Date() };
      await db.record.upsert({ where: { externalId: it.externalId }, create: data, update: data });
    }
    await db.syncRun.update({ where: { id: run.id }, data: { ok: true, fetched: items.length, finishedAt: new Date() } });
    return { ok: true, fetched: items.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.syncRun.update({ where: { id: run.id }, data: { ok: false, error, finishedAt: new Date() } });
    return { ok: false, fetched: 0, error };
  }
}
