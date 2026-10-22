import { db } from "../db.js";
import { SHIFT_START_HOUR, ZONES } from "../rules/time.js";

/** Settings an admin can change later. Missing ones fall back to these defaults. */
export const SETTING_DEFAULTS = {
  backfillStart: "2026-08-17", // nothing earlier is ingested or shown
  shiftStartHour: SHIFT_START_HOUR, // a day runs from 5 PM to just before 5 PM
  shiftZone: ZONES.ist,
  callDefaultZone: ZONES.eastern, // the zone the call-logs API logs call times in
  emailZone: ZONES.pacific, // Apollo's date filter (Pacific time, with daylight saving)
} as const;

export type Settings = { -readonly [K in keyof typeof SETTING_DEFAULTS]: (typeof SETTING_DEFAULTS)[K] extends number ? number : string };

export async function loadSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out as Settings;
}
