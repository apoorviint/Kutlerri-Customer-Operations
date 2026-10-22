import { db } from "../db.js";

/** True while any job has a lock (works across several running copies of the service). */
export async function isSyncing(): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM job_locks WHERE locked_at > timezone('UTC', now()) - interval '45 minutes'`;
  return rows[0].n > 0;
}
