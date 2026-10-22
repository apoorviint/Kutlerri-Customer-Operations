import { DateTime } from "luxon";

export const ZONES = {
  ist: "Asia/Kolkata",
  eastern: "America/New_York",
  pacific: "America/Los_Angeles",
} as const;

export const SHIFT_START_HOUR = 17; // a shift starts at 5 PM

/**
 * A rule says: calls by this agent (and/or on this phone line), from this local date on,
 * were logged in this time zone instead of the default one.
 */
export type TzRule = {
  agentKey?: string | null;
  lineNo10?: string | null;
  zone: string; // IANA name, or a fixed offset such as 'UTC-3'
  validFrom: string; // YYYY-MM-DD (the date the provider logged)
  validTo?: string | null;
};

export type CallWho = { agentKey?: string | null; lineNo10?: string | null; localDate: string };

/** The zone a call's date and time were logged in. The most specific, most recent matching rule wins. */
export function resolveCallZone(rules: TzRule[], who: CallWho, defaultZone: string): string {
  let best: { rule: TzRule; score: number } | null = null;
  for (const rule of rules) {
    if (rule.agentKey && rule.agentKey !== who.agentKey) continue;
    if (rule.lineNo10 && rule.lineNo10 !== who.lineNo10) continue;
    if (!rule.agentKey && !rule.lineNo10) continue; // a rule must name an agent or a line
    if (who.localDate < rule.validFrom) continue;
    if (rule.validTo && who.localDate > rule.validTo) continue;
    const score = (rule.agentKey ? 1 : 0) + (rule.lineNo10 ? 1 : 0);
    if (!best || score > best.score || (score === best.score && rule.validFrom > best.rule.validFrom)) best = { rule, score };
  }
  return best ? best.rule.zone : defaultZone;
}

/**
 * Turns the provider's local date and time into a UTC instant.
 * A time that does not exist (the hour skipped when clocks go forward) moves forward;
 * a time that happens twice (when clocks go back) takes the first one.
 */
export function toUtc(localDate: string, localTime: string, zone: string): Date {
  const t = /^\d{2}:\d{2}$/.test(localTime) ? `${localTime}:00` : localTime;
  const dt = DateTime.fromISO(`${localDate}T${t}`, { zone });
  if (!dt.isValid) throw new Error(`Invalid call time "${localDate} ${localTime}" in ${zone}: ${dt.invalidExplanation}`);
  return dt.toUTC().toJSDate();
}

/**
 * The shift day a moment belongs to: 5 PM to just before 5 PM the next day (in IST) is one day.
 * 4:59 PM belongs to the previous day, 5:00 PM starts the new one, 12:30 AM belongs to the day before.
 */
export function shiftDate(utc: Date, zone: string = ZONES.ist, startHour: number = SHIFT_START_HOUR): string {
  return DateTime.fromJSDate(utc, { zone }).minus({ hours: startHour }).toISODate()!;
}

/** The calendar date of an instant in a zone (used for Apollo's Pacific date filter). */
export function dateInZone(utc: Date, zone: string): string {
  return DateTime.fromJSDate(utc, { zone }).toISODate()!;
}

/** Today's date in a zone, as YYYY-MM-DD. */
export const todayIn = (zone: string, now: Date = new Date()) => dateInZone(now, zone);

export const addDays = (date: string, n: number) => DateTime.fromISO(date, { zone: "utc" }).plus({ days: n }).toISODate()!;

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
