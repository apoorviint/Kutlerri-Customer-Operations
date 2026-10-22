import { DateTime } from "luxon";

/** Dates are plain "YYYY-MM-DD" strings throughout; no time zones are involved. */
const d = (s: string) => DateTime.fromISO(s, { zone: "utc" });

export const addDays = (date: string, n: number) => d(date).plus({ days: n }).toISODate()!;
export const daysBetween = (from: string, to: string) => Math.round(d(to).diff(d(from), "days").days);
export const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && d(s).isValid;

/** ISO weeks run Monday to Sunday. */
export const mondayOf = (date: string) => d(date).minus({ days: d(date).weekday - 1 }).toISODate()!;
export const weekOf = (date: string): Period => ({ from: mondayOf(date), to: addDays(mondayOf(date), 6), granularity: "weekly" });
export const monthOf = (date: string): Period => ({ from: d(date).startOf("month").toISODate()!, to: d(date).endOf("month").toISODate()!, granularity: "monthly" });
export const dayOf = (date: string): Period => ({ from: date, to: date, granularity: "daily" });

export type Granularity = "daily" | "weekly" | "monthly" | "custom" | "override";
export type Period = { from: string; to: string | null; granularity: Granularity };

/** How many days a period covers. An open-ended period is the least specific there is. */
export const periodLength = (from: string, to: string | null) => (to === null ? Infinity : daysBetween(from, to) + 1);
export const covers = (from: string, to: string | null, date: string) => date >= from && (to === null || date <= to);

// ───────────── reading a heading such as "Week of Aug 17" or "Month of October 2026" ─────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

type YMD = { y: number | null; m: number; d: number | null };

/** The year when a heading does not say it: the year that puts the date closest to `anchor`. */
function withYear(p: YMD, anchor: string): string | null {
  const day = p.d ?? 1;
  if (p.y !== null) {
    const s = DateTime.utc(p.y, p.m, day);
    return s.isValid ? s.toISODate() : null;
  }
  const ay = d(anchor).year;
  const candidates = [ay - 1, ay, ay + 1].map((y) => DateTime.utc(y, p.m, day)).filter((x) => x.isValid);
  if (!candidates.length) return null;
  const a = d(anchor).toMillis();
  return candidates.sort((x, y) => Math.abs(x.toMillis() - a) - Math.abs(y.toMillis() - a))[0].toISODate();
}

function parseYmd(text: string): YMD | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return { y: +m[1], m: +m[2], d: +m[3] };
  if ((m = t.match(/^(\d{4})-(\d{1,2})$/))) return { y: +m[1], m: +m[2], d: null };
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return { y: +m[3], m: +m[1], d: +m[2] }; // month first, as in the US
  if ((m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)) && MONTHS[m[1].toLowerCase()]) return { y: m[3] ? +m[3] : null, m: MONTHS[m[1].toLowerCase()], d: +m[2] };
  if ((m = t.match(/^(\d{1,2})[\s-]+([A-Za-z]+)\.?(?:,?[\s-]+(\d{4}))?$/)) && MONTHS[m[2].toLowerCase()]) return { y: m[3] ? +m[3] : null, m: MONTHS[m[2].toLowerCase()], d: +m[1] };
  if ((m = t.match(/^([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/)) && MONTHS[m[1].toLowerCase()]) return { y: m[2] ? +m[2] : null, m: MONTHS[m[1].toLowerCase()], d: null };
  return null;
}

export type Heading = { period: Period; warning?: string };

/**
 * Reads a column heading as a period.
 *   "Week of Aug 17"            -> that Monday to Sunday
 *   "Month of Oct" / "Oct 2026" -> the whole month
 *   "Day of Oct 19", "Oct 19", "2026-10-19", an Excel date cell -> that one day
 * `anchor` (a date, normally today) picks the year when the heading leaves it out.
 */
export function parseHeading(cell: unknown, anchor: string): Heading | null {
  if (cell instanceof Date) {
    const iso = cell.toISOString().slice(0, 10);
    return isRealDate(iso) ? { period: dayOf(iso) } : null;
  }
  if (typeof cell !== "string") return null;
  const text = cell.trim().replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;

  if ((m = text.match(/^week\s*(?:of|starting|beginning)?\s*:?\s*(.+)$/i))) {
    const p = parseYmd(m[1]);
    const iso = p && p.d !== null ? withYear(p, anchor) : null;
    if (!iso) return null;
    const w = weekOf(iso);
    return { period: w, warning: w.from !== iso ? `"${text}" is not a Monday; used the week ${w.from} to ${w.to}` : undefined };
  }
  if ((m = text.match(/^month\s*(?:of)?\s*:?\s*(.+)$/i))) {
    const p = parseYmd(m[1]);
    const iso = p && p.d === null ? withYear(p, anchor) : null;
    return iso ? { period: monthOf(iso) } : null;
  }
  if ((m = text.match(/^(?:day|date)\s*(?:of)?\s*:?\s*(.+)$/i))) {
    const p = parseYmd(m[1]);
    const iso = p && p.d !== null ? withYear(p, anchor) : null;
    return iso ? { period: dayOf(iso) } : null;
  }
  const p = parseYmd(text);
  if (!p) return null;
  const iso = withYear(p, anchor);
  if (!iso) return null;
  return { period: p.d === null ? monthOf(iso) : dayOf(iso) };
}
