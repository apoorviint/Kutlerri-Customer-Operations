import { db } from "../db.js";

/** Records who did what, for every upload and every change to a setting or mapping. Never throws: a failed log must not undo the action. */
export async function audit(actor: string, action: string, target?: string | null, details?: unknown) {
  try {
    await db.auditLog.create({ data: { actor, action, target: target ?? null, details: details === undefined ? undefined : JSON.parse(JSON.stringify(details)) } });
  } catch (e) {
    console.error("[audit] could not write:", e instanceof Error ? e.message : e);
  }
}
