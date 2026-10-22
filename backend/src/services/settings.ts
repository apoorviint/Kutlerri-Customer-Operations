import { db } from "../db.js";
import { SHIFT_START_HOUR, ZONES } from "../rules/time.js";

export type Settings = {
  backfillStart: string;
  shiftStartHour: number;
  shiftZone: string;
  callDefaultZone: string;
  emailZone: string;
  agentFallback: boolean;
  agentFallbackExcludedLines: string[];
  outboundOnly: boolean;
};

/** Settings an admin can change later. Missing ones fall back to these defaults. */
export const SETTING_DEFAULTS: Settings = {
  backfillStart: "2026-08-17", // nothing earlier is ingested or shown
  shiftStartHour: SHIFT_START_HOUR, // a day runs from 5 PM to just before 5 PM
  shiftZone: ZONES.ist,
  callDefaultZone: ZONES.eastern, // the zone the call-logs API logs call times in
  emailZone: ZONES.pacific, // Apollo's date filter (Pacific time, with daylight saving)
  // A call on a line that is not on the sheet goes to the agent's Representative when that is clear (see rules/assignments.ts).
  // The prototype does this; the written spec says such calls are Unassigned, and that is the decision taken (off).
  // Turning it on makes the totals match the prototype's. The sheet is meant to list every line each day.
  agentFallback: false,
  // Lines that must stay Unassigned even when the rule above is turned on: Dave's (346) 423-3909 and (682) 356-3013.
  agentFallbackExcludedLines: ["3464233909", "6823563013"],
  // Only calls made from our side count. A call the source says is inbound is kept out of the dashboards;
  // a call whose direction is not given (all of them, until the call-logs API sends it) is treated as outbound.
  outboundOnly: true,
};

export async function loadSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out as Settings;
}
