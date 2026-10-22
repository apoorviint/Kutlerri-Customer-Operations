import { describe, expect, it } from "vitest";
import { addRow, childValue, connects, emptyTally, notAnswered, tallyOf, toStats, type RollupRow } from "../src/rules/metrics.js";
import { isoWeek, weeklyRevenue, type Order } from "../src/rules/revenue.js";
import { analyzeRepDay, DEFAULT_TIMING, scheduleOf, summarize, type TimedCall } from "../src/rules/timing.js";

const row = (o: Partial<RollupRow> = {}): RollupRow => ({
  calls: 0, meaningful: 0, mqlOver90: 0, dMql: 0, dInterested: 0, dCallback: 0, dNotInterested: 0, dWrongNumber: 0, dMqlFu: 0, dDnc: 0,
  dNoAnswer: 0, dBadNumber: 0, dVoicemail: 0, dMeeting: 0, dBlank: 0, dOther: 0, ...o,
});

describe("call metrics", () => {
  const t = tallyOf([
    row({ calls: 100, meaningful: 5, mqlOver90: 2, dMql: 3, dInterested: 4, dCallback: 2, dNotInterested: 6, dWrongNumber: 1, dMqlFu: 2, dDnc: 1, dNoAnswer: 41, dBadNumber: 5, dVoicemail: 7, dMeeting: 1, dBlank: 25, dOther: 2 }),
    row({ calls: 10, meaningful: 1, mqlOver90: 1, dMql: 1, dNoAnswer: 4, dBlank: 5 }),
  ]);
  const s = toStats(t);
  it("sums rows", () => {
    expect(s.calls).toBe(110);
    expect(s.meaningful).toBe(6);
  });
  it("connects and answered are the seven connect dispositions (voicemail and meeting are not)", () => {
    expect(connects(t)).toBe(3 + 4 + 2 + 6 + 1 + 2 + 1 + 1); // mql interested callback not_interested wrong_number mql_fu dnc + the second row's mql
    expect(s.answered).toBe(s.connects);
  });
  it("a call with no disposition counts as No Answer", () => {
    expect(childValue(t, "no_answer")).toBe(41 + 4 + 25 + 5);
    expect(s.dispositions.no_answer).toBe(75);
    expect(notAnswered(t)).toBe(75 + 5);
    expect(s.notAnswered).toBe(80);
  });
  it("voicemail, meeting and unrecognised text are in neither group", () => {
    expect(s.answered + s.notAnswered + t.d.voicemail + t.d.meeting + t.d.other).toBe(s.calls);
  });
  it("MQLs split into over 90 seconds and 90 seconds or less, always adding up", () => {
    expect(s.mql).toBe(4);
    expect(s.mqlOver90).toBe(3);
    expect(s.mqlUnder90).toBe(1);
    expect(s.mqlOver90 + s.mqlUnder90).toBe(s.mql);
  });
  it("mql_fu is not an MQL", () => {
    expect(toStats(addRow(emptyTally(), row({ calls: 1, dMqlFu: 1 }))).mql).toBe(0);
  });
  it("an empty group is all zeros", () => {
    expect(toStats(emptyTally())).toMatchObject({ calls: 0, connects: 0, notAnswered: 0, mql: 0 });
  });
});

describe("weekly revenue", () => {
  it("numbers ISO weeks (Oct 5 to Oct 11 is week 41)", () => {
    expect(isoWeek("2026-10-05")).toBe(41);
    expect(isoWeek("2026-10-11")).toBe(41);
    expect(isoWeek("2026-10-12")).toBe(42);
    expect(isoWeek("2026-08-17")).toBe(34);
  });
  // the prototype's 8 orders up to Oct 9 (rows by Representative, hover by client)
  const orders: Order[] = [
    { date: "2026-09-08", total: 180.24, groupId: 1, subId: 10 }, { date: "2026-09-16", total: 196.44, groupId: 2, subId: 10 },
    { date: "2026-09-22", total: 387.26, groupId: 1, subId: 10 }, { date: "2026-09-09", total: 776.48, groupId: 3, subId: 11 },
    { date: "2026-09-19", total: 583.61, groupId: 4, subId: 12 }, { date: "2026-09-17", total: 154.95, groupId: 5, subId: 12 },
    { date: "2026-10-02", total: 279.43, groupId: 4, subId: 12 }, { date: "2026-10-09", total: 282.45, groupId: 4, subId: 12 },
  ];
  const w = weeklyRevenue(orders);
  it("matches the acceptance figures: $2,840.86 from 8 orders, run rate $568.17 over 5 weeks", () => {
    expect(w.revenue).toBe(2840.86);
    expect(w.orders).toBe(8);
    expect(w.weeks).toHaveLength(5);
    expect(w.weeks[0]).toMatchObject({ monday: "2026-09-07", isoWeek: 37 });
    expect(w.weeks[4]).toMatchObject({ monday: "2026-10-05", isoWeek: 41 });
    expect(w.runRate).toBe(568.17);
    expect(w.avgOrder).toBe(355.11);
  });
  it("a week with no orders is still a column and still counts toward the run rate", () => {
    const gap = weeklyRevenue([{ date: "2026-09-08", total: 100, groupId: 1, subId: 1 }, { date: "2026-09-22", total: 200, groupId: 1, subId: 1 }]);
    expect(gap.weeks.map((x) => x.monday)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
    expect(gap.totals[1]).toMatchObject({ revenue: 0, orders: 0 });
    expect(gap.runRate).toBe(100); // 300 over 3 weeks
  });
  it("the hover list says who the orders came from, largest first", () => {
    const cell = w.rows.find((r) => r.id === 4)!.cells["2026-09-14"];
    expect(cell).toMatchObject({ revenue: 583.61, orders: 1, by: [{ id: 12, orders: 1, revenue: 583.61 }] });
    const total = w.totals[1]; // the week of Sep 14: orders on the 16th, 17th and 19th
    expect(total.by.map((b) => [b.id, b.orders])).toEqual([[12, 2], [10, 1]]);
  });
  it("rows are ordered by revenue; an empty range has no weeks and no run rate", () => {
    expect(w.rows.map((r) => r.id)).toEqual([4, 3, 1, 2, 5]);
    expect(weeklyRevenue([])).toMatchObject({ weeks: [], revenue: 0, orders: 0, runRate: null });
  });
});

// ───────────────────────── call timing ─────────────────────────

const OTHER = scheduleOf(DEFAULT_TIMING.default); // starts 7:30 PM, break 10:30 to 11:30 PM
const RASA = scheduleOf(DEFAULT_TIMING.clients.Rasa); // starts 6:30 PM, break 9:30 to 10:30 PM
const at = (h: number, m = 0) => h * 60 + m;
const call = (start: number, secs = 60, clientId = 1): TimedCall => ({ t: start, e: start + secs / 60, clientId });
const day = (calls: TimedCall[], rasaIs = -1) => analyzeRepDay(calls, (c) => (c === rasaIs ? RASA : OTHER), DEFAULT_TIMING);
/** Calls every 2 minutes from `from` to `to` (exclusive), so there are no pauses inside the stretch. */
const stretch = (from: number, to: number, clientId = 1) => Array.from({ length: Math.floor((to - from) / 2) }, (_, i) => call(from + i * 2, 60, clientId));

describe("call timing and breaks", () => {
  it("finds the break: the pause that starts near the scheduled break", () => {
    const d = day([...stretch(at(19, 30), at(22, 30)), ...stretch(at(23, 15), at(25, 0))]);
    expect(d.main).toMatchObject({ len: expect.closeTo(46, 0) });
    expect(Math.round(d.main!.from)).toBe(at(22, 29)); // the last call starts at 22:28 and ends at 22:29
    expect(d.other).toEqual([]);
  });
  it("counts dials before and after the break", () => {
    const before = stretch(at(19, 30), at(22, 30)), after = stretch(at(23, 30), at(24, 30));
    const d = day([...before, ...after]);
    expect(d.main).toMatchObject({ before: before.length, after: after.length });
  });
  it("a pause under 10 minutes is not a pause", () => {
    expect(day([...stretch(at(19, 30), at(22, 0)), call(at(22, 8)), ...stretch(at(22, 12), at(24, 0))]).main).toBeNull();
  });
  it("a 20 minute pause qualifies as a break (just under does not)", () => {
    const ok = day([...stretch(at(19, 30), at(22, 30)), call(at(22, 51))]); // last call ends 22:29, next at 22:51: 22 minutes
    expect(ok.main?.len).toBeCloseTo(22, 0);
    const short = day([...stretch(at(19, 30), at(22, 30)), call(at(22, 48))]); // 19 minutes: only an "other pause"
    expect(short.main).toBeNull();
    expect(short.other).toHaveLength(1);
  });
  it("a long pause far from the scheduled break is an 'other pause', not the break", () => {
    const d = day([...stretch(at(19, 30), at(20, 0)), ...stretch(at(20, 45), at(24, 0))]); // 45 minutes at 8 PM
    expect(d.main).toBeNull();
    expect(d.other).toHaveLength(1);
    expect(d.other[0].len).toBeCloseTo(46, 0); // from the end of the call at 19:58 to the next one at 20:45
  });
  it("the window is 90 minutes either side of the scheduled break start", () => {
    // the scheduled break starts at 22:30. A pause that starts at 21:00 (90 minutes before) is in the window; one at 20:59 is not.
    const pauseStartingAt = (end: number) => day([...stretch(at(19, 30), at(20, 58)), call(end - 1), ...stretch(end + 40, at(24, 0))]);
    expect(pauseStartingAt(at(21, 0)).main).not.toBeNull(); // the last call before the pause ends at exactly 21:00
    expect(pauseStartingAt(at(20, 59)).main).toBeNull(); // 91 minutes before: an "other pause"
    // and 90 minutes after the scheduled start (24:00) is the other edge
    const pauseAfter = (end: number) => day([...stretch(at(19, 30), at(23, 58)), call(end - 1), ...stretch(end + 40, end + 100)]);
    expect(pauseAfter(at(24, 0)).main).not.toBeNull();
    expect(pauseAfter(at(24, 1)).main).toBeNull();
  });
  it("of several pauses in the window, the longest is the break and the rest are 'other pauses'", () => {
    const d = day([...stretch(at(21, 40), at(22, 0)), ...stretch(at(22, 25), at(22, 45)), ...stretch(at(23, 45), at(24, 30))]);
    expect(d.main!.len).toBeGreaterThan(55); // the pause from about 22:45 to 23:45
    expect(d.other.length).toBe(1);
  });
  it("measures a pause from the latest END of any earlier call, so one long call hides a pause", () => {
    const d = day([call(at(22, 0), 3600), call(at(22, 5)), call(at(22, 40))]); // the first call runs until 23:00
    expect(d.main).toBeNull();
    expect(d.other).toEqual([]);
  });
  it("merges nearby calls to one client into a block and starts a new block when the client changes", () => {
    const d = day([call(at(19, 30), 60, 1), call(at(19, 32), 60, 1), call(at(19, 34), 60, 2), call(at(19, 36), 60, 2)]);
    expect(d.blocks.map((b) => [b.clientId, b.n])).toEqual([[1, 2], [2, 2]]);
  });
  it("the client with the most calls sets the schedule (Rasa starts an hour earlier)", () => {
    const rasa = day([...stretch(at(18, 30), at(21, 30), 7), ...stretch(at(22, 40), at(24, 0), 7)], 7);
    expect(rasa.schedule).toEqual(RASA);
    expect(rasa.topClientId).toBe(7);
    expect(rasa.lateStart).toBe(false);
    const other = day([...stretch(at(18, 30), at(21, 30), 3)], 7);
    expect(other.schedule).toEqual(OTHER);
    expect(other.lateStart).toBe(false); // started an hour EARLY
    expect(other.firstDelta).toBe(-60);
  });
  it("flags a late start, a late return and a break more than 10 minutes over", () => {
    const d = day([...stretch(at(19, 45), at(22, 30)), ...stretch(at(23, 45), at(24, 30))]);
    expect(d.lateStart).toBe(true); // 15 minutes after 7:30 PM
    expect(d.lateReturn).toBe(true); // back at 23:45 against 23:30
    expect(d.breakOver).toBe(true); // 76 minutes against 60 allowed
    const ok = day([...stretch(at(19, 35), at(22, 30)), ...stretch(at(23, 30), at(24, 30))]);
    expect(ok.lateStart).toBe(false); // 5 minutes late is within the grace
    expect(ok.breakOver).toBe(false);
    expect(ok.lateReturn).toBe(false);
  });
  it("summarises a day", () => {
    const a = day([...stretch(at(19, 30), at(22, 30)), ...stretch(at(23, 30), at(24, 0))]);
    const b = day([...stretch(at(20, 0), at(22, 30)), ...stretch(at(24, 0), at(24, 30))]);
    const c = day(stretch(at(19, 30), at(24, 0)));
    const s = summarize([a, b, c]);
    expect(s).toMatchObject({ dialing: 3, breaks: 2, breakOver: 1, backLate: 1, lateStart: 1 });
    expect(s.avgBreak).toBeGreaterThan(60);
  });
});
