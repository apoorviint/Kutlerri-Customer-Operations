/**
 * Call timing and breaks (one Representative on one shift day, all clients together).
 * Times are minutes after midnight of the shift date in IST, so a call at 1:30 AM the next morning is 25h30 = 1530.
 */
export type TimingSettings = {
  gapMinutes: number; // a pause counts from this many idle minutes
  breakMinMinutes: number; // the break is the longest pause at least this long...
  windowMinutes: number; // ...that starts within this many minutes before or after the scheduled break start
  graceMinutes: number; // "on time" means within this
  allowedBreakMinutes: number;
  default: { start: string; breakStart: string; breakEnd: string }; // "HH:MM", 24 hour
  clients: Record<string, { start: string; breakStart: string; breakEnd: string }>; // by client name (Rasa has its own)
};

export const DEFAULT_TIMING: TimingSettings = {
  gapMinutes: 10, breakMinMinutes: 20, windowMinutes: 90, graceMinutes: 10, allowedBreakMinutes: 60,
  default: { start: "19:30", breakStart: "22:30", breakEnd: "23:30" },
  clients: { Rasa: { start: "18:30", breakStart: "21:30", breakEnd: "22:30" } },
};

export type Schedule = { start: number; breakStart: number; breakEnd: number };
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const scheduleOf = (s: { start: string; breakStart: string; breakEnd: string }): Schedule => ({ start: minutes(s.start), breakStart: minutes(s.breakStart), breakEnd: minutes(s.breakEnd) });

export type TimedCall = { t: number; e: number; clientId: number }; // start and end (start + duration)
export type Pause = { from: number; to: number; len: number };
export type Break = Pause & { before: number; after: number };

export type RepDay = {
  calls: number;
  first: number;
  last: number;
  topClientId: number;
  clientIds: number[]; // most calls first
  schedule: Schedule;
  blocks: { s: number; e: number; clientId: number; n: number }[];
  main: Break | null;
  other: Pause[];
  // how this day compares with the schedule (positive = later or longer)
  firstDelta: number;
  breakStartDelta: number | null;
  returnDelta: number | null;
  breakLenDelta: number | null;
  lateStart: boolean;
  lateReturn: boolean;
  breakOver: boolean;
};

/**
 * Works out a day for one Representative.
 *  - A pause is idle time between the latest end of any earlier call and the next call's start, counted from `gapMinutes`.
 *  - The break is the longest pause of `breakMinMinutes` or more that starts within `windowMinutes` of the scheduled break start.
 *    Other pauses are listed as "other pauses".
 *  - The client with the most calls that day sets the schedule.
 */
export function analyzeRepDay(input: TimedCall[], scheduleFor: (clientId: number) => Schedule, s: TimingSettings): RepDay {
  const calls = [...input].sort((a, b) => a.t - b.t);
  const counts = new Map<number, number>();
  for (const x of calls) counts.set(x.clientId, (counts.get(x.clientId) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const top = ranked[0][0];
  const sch = scheduleFor(top);

  const blocks: RepDay["blocks"] = [];
  const gaps: Break[] = [];
  let cur: RepDay["blocks"][number] | null = null;
  let maxEnd = calls[0].t;
  for (const [i, x] of calls.entries()) {
    const gap = x.t - maxEnd;
    if (cur && gap < s.gapMinutes && x.clientId === cur.clientId) {
      cur.e = Math.max(cur.e, x.e);
      cur.n++;
    } else {
      if (cur && gap >= s.gapMinutes) gaps.push({ from: maxEnd, to: x.t, len: gap, before: i, after: calls.length - i });
      cur = { s: x.t, e: x.e, clientId: x.clientId, n: 1 };
      blocks.push(cur);
    }
    maxEnd = Math.max(maxEnd, x.e);
  }
  const main = gaps.filter((g) => g.len >= s.breakMinMinutes && Math.abs(g.from - sch.breakStart) <= s.windowMinutes).sort((a, b) => b.len - a.len)[0] ?? null;
  const allowed = sch.breakEnd - sch.breakStart;
  const firstDelta = calls[0].t - sch.start;
  return {
    calls: calls.length,
    first: calls[0].t,
    last: calls[calls.length - 1].t,
    topClientId: top,
    clientIds: ranked.map((r) => r[0]),
    schedule: sch,
    blocks,
    main,
    other: gaps.filter((g) => g !== main).map(({ from, to, len }) => ({ from, to, len })),
    firstDelta,
    breakStartDelta: main ? main.from - sch.breakStart : null,
    returnDelta: main ? main.to - sch.breakEnd : null,
    breakLenDelta: main ? main.len - allowed : null,
    lateStart: firstDelta > s.graceMinutes,
    lateReturn: !!main && main.to - sch.breakEnd > s.graceMinutes,
    breakOver: !!main && main.len - allowed > s.graceMinutes,
  };
}

/** The headline numbers for a day: how many dialed, average break, how many broke the rules. */
export function summarize(days: RepDay[]) {
  const withBreak = days.filter((d) => d.main);
  return {
    dialing: days.length,
    breaks: withBreak.length,
    avgBreak: withBreak.length ? withBreak.reduce((n, d) => n + d.main!.len, 0) / withBreak.length : null,
    breakOver: withBreak.filter((d) => d.breakOver).length,
    backLate: withBreak.filter((d) => d.lateReturn).length,
    lateStart: days.filter((d) => d.lateStart).length,
  };
}
