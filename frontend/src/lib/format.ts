import type { DispositionKey } from "./types";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const n0 = (v: number | null | undefined) => (v == null ? "–" : Math.round(v).toLocaleString("en-US"));
export const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "–");
export const usd = (v: number | null | undefined) => (v == null ? "–" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Dates are "YYYY-MM-DD" strings; they are read as plain calendar dates, never shifted by a time zone. */
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];
export const dateOf = (s: string) => { const [y, m, d] = parts(s); return new Date(y, m - 1, d); };
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fShort = (s: string) => { const d = dateOf(s); return `${MON[d.getMonth()]} ${d.getDate()}`; };
export const addDays = (s: string, n: number) => { const d = dateOf(s); d.setDate(d.getDate() + n); return iso(d); };
export const dayName = (s: string) => `${DOW[dateOf(s).getDay()]}, ${fShort(s)}`;

/** Quick periods, worked out from today's date (weeks run Monday to Sunday). */
export type Preset = "custom" | "last_week" | "this_week" | "last_month" | "this_month" | "today" | "yesterday";
export function presetRange(k: Preset, today: string): [string, string] | null {
  const t = dateOf(today);
  const mon = addDays(today, -((t.getDay() + 6) % 7));
  switch (k) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "this_week": return [mon, addDays(mon, 6)];
    case "last_week": return [addDays(mon, -7), addDays(mon, -1)];
    case "this_month": return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
    case "last_month": return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
    default: return null;
  }
}

export const LABELS: Record<DispositionKey, string> = {
  mql: "MQL", interested: "Interested / FUP Needed", callback: "Call Back Later", not_interested: "Not Interested",
  wrong_number: "Wrong Number", mql_fu: "MQL Follow-Up", dnc: "Do Not Call Again", no_answer: "No Answer", bad_number: "Bad Number",
  voicemail: "Left Voicemail", meeting: "Meeting Set",
};
export const ANSWERED_KEYS = ["mql", "interested", "callback", "not_interested", "wrong_number", "mql_fu", "dnc"] as const;
export const NOT_ANSWERED_KEYS = ["no_answer", "bad_number"] as const;

// The six clients each keep one colour everywhere (dots, chips, tables).
const COLORS: Record<string, string> = { "Rasa": "#7c3aed", "HotChi": "#ef4f8b", "Cedar's": "#22b5d8", "Gyro Republic": "#ff7a45", "Eight Turn Crepe": "#93c5fd", "Kati Roll": "#f2b600" };
const SPARE = ["#16a34a", "#9f7cef", "#0f766e", "#b45309"];
export const colorOf = (name: string) => COLORS[name] ?? SPARE[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % SPARE.length];

export const fmtPhone = (p: string | null) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : "");
/** Talk time as m:ss */
export const fmtTalk = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ── call timing: minutes after midnight of the shift day, IST (a time past 1440 is the next morning) ──
export const clock = (m: number) => { const r = Math.round(m); const h = Math.floor(r / 60) % 24; return `${((h + 11) % 12) + 1}:${String(r % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
export const dur = (m: number) => { const r = Math.round(m); return r >= 60 ? `${Math.floor(r / 60)}h ${String(r % 60).padStart(2, "0")}m` : `${r}m`; };
export const tick = (h: number) => `${((h % 24) + 11) % 12 + 1} ${h % 24 >= 12 ? "PM" : "AM"}`;
/** "on time", "12m late", "8m early" (within the grace it is on time) */
export const when = (delta: number, grace: number) => (Math.abs(delta) <= grace ? "on time" : `${Math.round(Math.abs(delta))}m ${delta > 0 ? "late" : "early"}`);


/** ISO week number (weeks run Monday to Sunday). */
export function isoWeek(s: string) {
  const d = new Date(Date.UTC(...(s.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/** "19:30" -> "7:30 PM" */
export const hhmm = (s: string) => { const [h, m] = s.split(":").map(Number); return clock(h * 60 + m); };
