import { CONNECT_KEYS, DISPOSITION_KEYS, type DispositionKey } from "./calls.js";

/** Counts of calls for any group (a client, a Representative, a day). Built from the daily rollup rows. */
export type Tally = {
  calls: number;
  meaningful: number; // a connect longer than 90 seconds
  mqlOver90: number;
  d: Record<DispositionKey | "blank" | "other", number>; // blank = no disposition, other = a disposition text we do not recognise
};

export const emptyTally = (): Tally => ({
  calls: 0, meaningful: 0, mqlOver90: 0,
  d: Object.fromEntries([...DISPOSITION_KEYS, "blank", "other"].map((k) => [k, 0])) as Tally["d"],
});

/** One row of `daily_rollups`, as Prisma returns it. */
export type RollupRow = {
  calls: number; meaningful: number; mqlOver90: number;
  dMql: number; dInterested: number; dCallback: number; dNotInterested: number; dWrongNumber: number; dMqlFu: number; dDnc: number;
  dNoAnswer: number; dBadNumber: number; dVoicemail: number; dMeeting: number; dBlank: number; dOther: number;
};

export function addRow(t: Tally, r: RollupRow): Tally {
  t.calls += r.calls; t.meaningful += r.meaningful; t.mqlOver90 += r.mqlOver90;
  t.d.mql += r.dMql; t.d.interested += r.dInterested; t.d.callback += r.dCallback; t.d.not_interested += r.dNotInterested;
  t.d.wrong_number += r.dWrongNumber; t.d.mql_fu += r.dMqlFu; t.d.dnc += r.dDnc; t.d.no_answer += r.dNoAnswer;
  t.d.bad_number += r.dBadNumber; t.d.voicemail += r.dVoicemail; t.d.meeting += r.dMeeting; t.d.blank += r.dBlank; t.d.other += r.dOther;
  return t;
}

export const tallyOf = (rows: RollupRow[]) => rows.reduce(addRow, emptyTally());

/** A call with no disposition counts as No Answer. */
export const childValue = (t: Tally, key: DispositionKey) => t.d[key] + (key === "no_answer" ? t.d.blank : 0);

/** Connects and Answered are the same seven dispositions. */
export const connects = (t: Tally) => CONNECT_KEYS.reduce((n, k) => n + t.d[k], 0);

/** Not answered: No Answer (including calls with no disposition) and Bad Number. Voicemail and Meeting are in neither group. */
export const notAnswered = (t: Tally) => childValue(t, "no_answer") + t.d.bad_number;

/** What the screens show for a group. */
export function toStats(t: Tally) {
  return {
    calls: t.calls,
    connects: connects(t),
    meaningful: t.meaningful,
    mql: t.d.mql,
    mqlOver90: t.mqlOver90,
    mqlUnder90: t.d.mql - t.mqlOver90, // the two always add up to the MQL total
    answered: connects(t),
    notAnswered: notAnswered(t),
    // the breakdown under Answered and Not answered; No Answer includes calls with no disposition
    dispositions: {
      mql: t.d.mql, interested: t.d.interested, callback: t.d.callback, not_interested: t.d.not_interested, wrong_number: t.d.wrong_number,
      mql_fu: t.d.mql_fu, dnc: t.d.dnc, no_answer: childValue(t, "no_answer"), bad_number: t.d.bad_number,
    },
  };
}
export type Stats = ReturnType<typeof toStats>;
