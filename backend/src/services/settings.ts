import { db } from "../db.js";
import { SHIFT_START_HOUR, ZONES } from "../rules/time.js";
import { DEFAULT_TIMING, type TimingSettings } from "../rules/timing.js";

export type Settings = {
  backfillStart: string;
  shiftStartHour: number;
  shiftZone: string;
  callDefaultZone: string;
  emailZone: string;
  agentFallback: boolean;
  agentFallbackExcludedLines: string[];
  timing: TimingSettings;
  prospectShow: Record<string, string[]>;
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
  // Call timing and breaks: schedules as logged (Rasa starts 6:30 PM, break 9:30 to 10:30 PM; everyone else 7:30 PM, 10:30 to 11:30 PM)
  timing: DEFAULT_TIMING,
  // What to show for a prospect in a recording row, per client (a phone number is added where listed). Name, title and company are always shown.
  prospectShow: { "Eight Turn Crepe": ["name", "phone"] },
};

export async function loadSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out as Settings;
}
