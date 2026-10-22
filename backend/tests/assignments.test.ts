import { describe, expect, it } from "vitest";
import { dayOf, monthOf, parseHeading, weekOf, covers, periodLength } from "../src/rules/periods.js";
import { attributeCall, findSuspiciousSwaps, type Assignment } from "../src/rules/assignments.js";
import { extractPhones, parseAssignmentSheet } from "../src/rules/assignmentSheet.js";

const ANCHOR = "2026-10-22";

describe("periods", () => {
  it("a week is Monday to Sunday (Oct 5 to Oct 11 is the week of Oct 5)", () => {
    expect(weekOf("2026-10-07")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(weekOf("2026-10-11")).toMatchObject({ from: "2026-10-05", to: "2026-10-11" });
    expect(weekOf("2026-10-12")).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("a month and a day", () => {
    expect(monthOf("2026-10-19")).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthOf("2026-02-10").to).toBe("2026-02-28");
    expect(dayOf("2026-10-19")).toMatchObject({ from: "2026-10-19", to: "2026-10-19" });
  });
  it("how long a period is, and whether it covers a date", () => {
    expect(periodLength("2026-10-12", "2026-10-18")).toBe(7);
    expect(periodLength("2026-10-19", "2026-10-19")).toBe(1);
    expect(periodLength("2026-08-17", null)).toBe(Infinity);
    expect(covers("2026-10-12", "2026-10-18", "2026-10-18")).toBe(true);
    expect(covers("2026-10-12", "2026-10-18", "2026-10-19")).toBe(false);
    expect(covers("2026-08-17", null, "2027-01-01")).toBe(true);
  });
});

describe("period headings", () => {
  const p = (h: unknown) => parseHeading(h, ANCHOR);
  it("weekly headings, in the forms people write them", () => {
    expect(p("Week of Aug 17")?.period).toMatchObject({ from: "2026-08-17", to: "2026-08-23", granularity: "weekly" });
    expect(p("Week of 24 Aug")?.period).toMatchObject({ from: "2026-08-24", to: "2026-08-30" });
    expect(p("Week of Oct 12, 2026")?.period).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(p("Week of 2026-10-05")?.period.from).toBe("2026-10-05");
    expect(p("week of oct 12")?.period.from).toBe("2026-10-12");
  });
  it("a heading that is not a Monday is moved to its Monday, with a warning", () => {
    const h = p("Week of Oct 14");
    expect(h?.period).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(h?.warning).toMatch(/not a Monday/);
  });
  it("monthly headings", () => {
    expect(p("Month of October 2026")?.period).toMatchObject({ from: "2026-10-01", to: "2026-10-31", granularity: "monthly" });
    expect(p("Month of Oct")?.period.from).toBe("2026-10-01");
    expect(p("November 2026")?.period).toMatchObject({ from: "2026-11-01", to: "2026-11-30", granularity: "monthly" });
    expect(p("2026-11")?.period.granularity).toBe("monthly");
  });
  it("daily headings (the daily uploads after Oct 18)", () => {
    for (const h of ["Oct 19", "Day of Oct 19", "2026-10-19", "19 Oct", "10/19/2026", "Oct 19, 2026", "Date: Oct 19"]) {
      expect(p(h)?.period, h).toMatchObject({ from: "2026-10-19", to: "2026-10-19", granularity: "daily" });
    }
    expect(p(new Date("2026-10-19T00:00:00Z"))?.period).toMatchObject({ from: "2026-10-19", granularity: "daily" });
  });
  it("picks the year closest to today when the heading leaves it out", () => {
    expect(parseHeading("Week of Dec 28", "2027-01-05")?.period.from).toBe("2026-12-28");
    expect(parseHeading("Week of Jan 4", "2026-12-20")?.period.from).toBe("2027-01-04");
  });
  it("things that are not headings", () => {
    for (const h of ["Representative", "Client", "", "(571) 500-2756", "Week of nonsense", null, 42]) expect(p(h), String(h)).toBeNull();
  });
});

// ───────────────────────── attribution ─────────────────────────

const a = (o: Partial<Assignment> & { id: number }): Assignment => ({
  phoneNo10: "5715002756", representativeId: 1, clientId: 10, clientKind: "CUSTOMER", validFrom: "2026-10-12", validTo: "2026-10-18", priority: 1, ...o,
});

describe("which assignment a call gets", () => {
  it("no row covering the day means Unassigned (stored, never shown)", () => {
    expect(attributeCall([], "2026-10-13", null)).toMatchObject({ status: "UNASSIGNED", reason: "no-assignment" });
    expect(attributeCall([a({ id: 1 })], "2026-10-19", null).status).toBe("UNASSIGNED"); // the week ended on the 18th
    expect(attributeCall([a({ id: 1 })], "2026-10-11", null).status).toBe("UNASSIGNED"); // and starts on the 12th
  });
  it("a row covering the day assigns the Representative and client", () => {
    expect(attributeCall([a({ id: 1 })], "2026-10-13", null)).toEqual({ status: "CLIENT", clientId: 10, representativeId: 1, assignmentId: 1, reason: "sheet" });
  });
  it("a line assigned to Kutlerri is Internal", () => {
    expect(attributeCall([a({ id: 1, clientKind: "INTERNAL", clientId: 99 })], "2026-10-13", null)).toMatchObject({ status: "INTERNAL", clientId: 99 });
  });

  describe("weekly, monthly and daily rows together", () => {
    const week = a({ id: 1, validFrom: "2026-10-12", validTo: "2026-10-18", clientId: 10 });
    const month = a({ id: 2, validFrom: "2026-10-01", validTo: "2026-10-31", clientId: 20 });
    const day = a({ id: 3, validFrom: "2026-10-19", validTo: "2026-10-19", clientId: 30 });
    it("a monthly upload that overlaps weekly dates keeps the weekly data for those dates", () => {
      expect(attributeCall([week, month], "2026-10-12", null).clientId).toBe(10);
      expect(attributeCall([week, month], "2026-10-18", null).clientId).toBe(10);
      expect(attributeCall([week, month], "2026-10-19", null).clientId).toBe(20); // from Oct 19 the monthly row applies
      expect(attributeCall([week, month], "2026-10-05", null).clientId).toBe(20); // before the week, the month covers it
    });
    it("a daily row beats both for its one day, and only that day", () => {
      expect(attributeCall([week, month, day], "2026-10-19", null).clientId).toBe(30);
      expect(attributeCall([week, month, day], "2026-10-20", null).clientId).toBe(20);
    });
    it("the order the rows arrive in makes no difference", () => {
      for (const order of [[week, month, day], [day, month, week], [month, day, week]]) {
        expect(attributeCall(order, "2026-10-19", null).clientId).toBe(30);
        expect(attributeCall(order, "2026-10-15", null).clientId).toBe(10);
      }
    });
  });

  describe("standing fallbacks (the legacy overrides)", () => {
    const fallback = a({ id: 5, validFrom: "2026-08-17", validTo: null, priority: 0, clientKind: "INTERNAL", clientId: 99 });
    it("fill the gaps when no sheet row covers the day", () => {
      expect(attributeCall([fallback], "2026-10-13", null)).toMatchObject({ status: "INTERNAL", reason: "fallback" });
    });
    it("lose to any sheet row, even a long one", () => {
      const sheet = a({ id: 6, validFrom: "2026-10-01", validTo: "2026-10-31", clientId: 10 });
      expect(attributeCall([fallback, sheet], "2026-10-13", null)).toMatchObject({ status: "CLIENT", clientId: 10, reason: "sheet" });
    });
  });

  describe("a line listed for two Representatives in the same period", () => {
    const dave = a({ id: 1, representativeId: 3, clientId: 10 });
    const hiya = a({ id: 2, representativeId: 5, clientId: 10 });
    it("the agent on the call decides", () => {
      expect(attributeCall([dave, hiya], "2026-10-13", 3)).toMatchObject({ status: "CLIENT", representativeId: 3, reason: "shared-line-by-agent" });
      expect(attributeCall([dave, hiya], "2026-10-13", 5)).toMatchObject({ representativeId: 5, reason: "shared-line-by-agent" });
    });
    it("a third person on the line cannot be decided, so it is flagged rather than guessed", () => {
      expect(attributeCall([dave, hiya], "2026-10-13", 7)).toMatchObject({ status: "CONFLICT", reason: "ambiguous", clientId: null });
      expect(attributeCall([dave, hiya], "2026-10-13", null).status).toBe("CONFLICT");
    });
    it("works when the two Representatives are on different clients too", () => {
      const other = a({ id: 3, representativeId: 5, clientId: 20 });
      expect(attributeCall([dave, other], "2026-10-13", 5)).toMatchObject({ clientId: 20, representativeId: 5 });
    });
    it("the same row listed twice is not a conflict", () => {
      expect(attributeCall([dave, { ...dave, id: 9 }], "2026-10-13", null).status).toBe("CLIENT");
    });
  });
});

describe("a call on a line that is not on the sheet (agent fallback)", () => {
  const rep = 3;
  const mine = (id: number, clientId: number, o: Partial<Assignment> = {}) => a({ id, phoneNo10: "9990001111", representativeId: rep, clientId, ...o });
  it("goes to the agent's Representative when they had exactly one client that day", () => {
    const r = attributeCall([], "2026-10-13", rep, [mine(1, 10)]);
    expect(r).toEqual({ status: "CLIENT", clientId: 10, representativeId: rep, assignmentId: 1, reason: "agent-fallback" });
  });
  it("stays Unassigned when they had two clients (two customers: ambiguous)", () => {
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 10), mine(2, 20)]).status).toBe("UNASSIGNED");
  });
  it("ignores Kutlerri's own lines when counting clients", () => {
    const r = attributeCall([], "2026-10-13", rep, [mine(1, 10), mine(2, 99, { clientKind: "INTERNAL" })]);
    expect(r).toMatchObject({ status: "CLIENT", clientId: 10 });
  });
  it("a Representative with only Kutlerri lines gives an Internal call", () => {
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 99, { clientKind: "INTERNAL" })])).toMatchObject({ status: "INTERNAL", clientId: 99 });
  });
  it("only looks at lines that cover that day, and never at standing fallbacks", () => {
    expect(attributeCall([], "2026-10-25", rep, [mine(1, 10)]).status).toBe("UNASSIGNED"); // the week ended on the 18th
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 10, { priority: 0 })]).status).toBe("UNASSIGNED");
  });
  it("a different Representative's lines do not count", () => {
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 10, { representativeId: 8 })]).status).toBe("UNASSIGNED");
  });
  it("the clients of the lines they dialed that same day decide first (Steven: two clients on the sheet, one in use)", () => {
    const two = [mine(1, 10), mine(2, 20)];
    expect(attributeCall([], "2026-10-13", rep, two, new Set([10]))).toMatchObject({ status: "CLIENT", clientId: 10, reason: "agent-fallback" });
    expect(attributeCall([], "2026-10-13", rep, two, new Set([20]))).toMatchObject({ clientId: 20 });
  });
  it("two clients in use that day falls back to the sheet; two customer clients stay Unassigned (Dave)", () => {
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 10), mine(2, 20)], new Set([10, 20])).status).toBe("UNASSIGNED");
    expect(attributeCall([], "2026-10-13", rep, [mine(1, 10)], new Set([10, 20]))).toMatchObject({ clientId: 10 });
  });
  it("is off when no rows are passed, and not used when the line is on the sheet", () => {
    expect(attributeCall([], "2026-10-13", rep, null).status).toBe("UNASSIGNED");
    expect(attributeCall([a({ id: 7, clientId: 30 })], "2026-10-13", rep, [mine(1, 10)])).toMatchObject({ clientId: 30, reason: "sheet" });
  });
  it("a line shared by two Representatives that cannot be decided is flagged, not rescued by the fallback", () => {
    const shared = [a({ id: 1, representativeId: 3, clientId: 10 }), a({ id: 2, representativeId: 5, clientId: 10 })];
    expect(attributeCall(shared, "2026-10-13", 7, [mine(9, 40, { representativeId: 7 })]).status).toBe("CONFLICT");
  });
});

describe("suspicious swaps in a sheet", () => {
  const row = (rep: string, phone: string, client: string, from: string) => ({ representative: rep, phoneNo10: phone, client, from, to: null as string | null });
  it("flags two numbers whose clients trade places (the Andrew case)", () => {
    const rows = [
      row("Andrew", "5715002756", "Rasa", "2026-09-21"), row("Andrew", "9295529521", "Kati Roll", "2026-09-21"),
      row("Andrew", "5715002756", "Kati Roll", "2026-09-28"), row("Andrew", "9295529521", "Rasa", "2026-09-28"),
    ];
    const s = findSuspiciousSwaps(rows);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ representative: "Andrew", between: ["2026-09-21", "2026-09-28"] });
  });
  it("does not flag an ordinary change of client", () => {
    expect(findSuspiciousSwaps([
      row("Andrew", "5715002756", "Rasa", "2026-09-21"), row("Andrew", "5715002756", "Kati Roll", "2026-09-28"),
      row("Andrew", "9295529521", "Kati Roll", "2026-09-21"), row("Andrew", "9295529521", "Kati Roll", "2026-09-28"),
    ])).toEqual([]);
  });
});

// ───────────────────────── reading a sheet ─────────────────────────

describe("phone numbers in a cell", () => {
  it("one or several, in any common format", () => {
    expect(extractPhones("(571) 500-2756")).toEqual(["5715002756"]);
    expect(extractPhones("571-500-2756")).toEqual(["5715002756"]);
    expect(extractPhones("+1 571 500 2756")).toEqual(["5715002756"]);
    expect(extractPhones(5715002756)).toEqual(["5715002756"]);
    expect(extractPhones("(929) 521-6672 / (940) 245-4087")).toEqual(["9295216672", "9402454087"]);
    expect(extractPhones("-")).toEqual([]);
    expect(extractPhones("")).toEqual([]);
    expect(extractPhones(null)).toEqual([]);
    expect(extractPhones("TBD")).toEqual([]);
  });
});

describe("the legacy wide sheet", () => {
  const grid = [
    ["Sales Rep", "Client", "Week of Aug 17", "Week of Aug 24", "Week of Oct 12"],
    ["Andrew", "Rasa", "(571) 500-2756", "(571) 500-2756", "-"],
    ["", "Kati Roll", "(929) 552-9521", "", "(929) 552-9521"], // the name carries down from the row above
    ["Dave", "Rasa", "(929) 521-6672 / (940) 245-4087", "n/a", "TBD"],
  ];
  const r = parseAssignmentSheet(grid, { anchor: ANCHOR });
  it("reads every number under its week, with the Representative carried down", () => {
    expect(r.layout).toBe("legacy");
    expect(r.errors).toEqual([]);
    const pick = (rep: string, phone: string) => r.rows.filter((x) => x.representative === rep && x.phoneNo10 === phone).map((x) => `${x.client}@${x.from}`);
    expect(pick("Andrew", "5715002756")).toEqual(["Rasa@2026-08-17", "Rasa@2026-08-24"]);
    expect(pick("Andrew", "9295529521")).toEqual(["Kati Roll@2026-08-17", "Kati Roll@2026-10-12"]);
    expect(pick("Dave", "9295216672")).toEqual(["Rasa@2026-08-17"]);
    expect(pick("Dave", "9402454087")).toEqual(["Rasa@2026-08-17"]);
    expect(r.rows.every((x) => x.granularity === "weekly" && x.to !== null)).toBe(true);
  });
  it("skips unused cells quietly and warns about text that is not a number", () => {
    expect(r.rows.some((x) => x.from === "2026-10-12" && x.representative === "Dave")).toBe(false);
    expect(r.warnings.join("\n")).toMatch(/"TBD" is not a phone number/);
    expect(r.warnings.join("\n")).not.toMatch(/n\/a/);
  });
  it("weekly, monthly and daily columns can sit in one sheet (the daily uploads after Oct 18)", () => {
    const mixed = parseAssignmentSheet([
      ["Rep", "Client", "Week of Oct 12", "Oct 19", "Oct 20", "Month of November 2026"],
      ["Phoebe", "HotChi", "(773) 398-6668", "(773) 398-6668", "", "(773) 398-6668"],
    ], { anchor: ANCHOR });
    expect(mixed.rows.map((x) => [x.granularity, x.from, x.to])).toEqual([
      ["weekly", "2026-10-12", "2026-10-18"], ["daily", "2026-10-19", "2026-10-19"], ["monthly", "2026-11-01", "2026-11-30"],
    ]);
  });
  it("a number with no client is an error, not a guess", () => {
    const bad = parseAssignmentSheet([["Rep", "Client", "Week of Aug 17"], ["Andrew", "", "(571) 500-2756"]], { anchor: ANCHOR });
    expect(bad.errors[0]).toMatch(/client is blank/);
  });
  it("a file that is not a sheet is refused with a clear message", () => {
    expect(parseAssignmentSheet([["Name", "Age"], ["x", 4]], { anchor: ANCHOR }).errors[0]).toMatch(/does not look like/);
    expect(parseAssignmentSheet([], { anchor: ANCHOR }).errors[0]).toMatch(/empty/);
  });
});

describe("the normalized template", () => {
  it("daily rows, one day each", () => {
    const r = parseAssignmentSheet([
      ["Date", "Representative", "Client", "Phone number"],
      ["2026-10-19", "Phoebe", "HotChi", "(773) 398-6668"],
      ["2026-10-20", "Phoebe", "HotChi", "(773) 398-6668"],
    ], { anchor: ANCHOR });
    expect(r.layout).toBe("normalized");
    expect(r.rows.map((x) => [x.from, x.to, x.granularity])).toEqual([["2026-10-19", "2026-10-19", "daily"], ["2026-10-20", "2026-10-20", "daily"]]);
  });
  it("monthly rows and valid-from / valid-to rows", () => {
    const m = parseAssignmentSheet([["Month", "Representative", "Client", "Phone number"], ["October 2026", "Kevin", "Gyro Republic", "5551234567"]], { anchor: ANCHOR });
    expect(m.rows[0]).toMatchObject({ from: "2026-10-01", to: "2026-10-31", granularity: "monthly" });
    const v = parseAssignmentSheet([
      ["Representative", "Client", "Phone number", "Valid from", "Valid to"],
      ["Kevin", "Gyro Republic", "5551234567", "2026-10-19", "2026-10-25"],
      ["Kevin", "Gyro Republic", "5551234568", "2026-10-26", ""],
    ], { anchor: ANCHOR });
    expect(v.rows.map((x) => [x.from, x.to])).toEqual([["2026-10-19", "2026-10-25"], ["2026-10-26", null]]);
  });
  it("a row with no phone number or no period is an error that names the row", () => {
    const r = parseAssignmentSheet([["Date", "Representative", "Client", "Phone number"], ["2026-10-19", "Kevin", "Gyro Republic", "n/a"], ["", "Kevin", "Gyro Republic", "5551234567"]], { anchor: ANCHOR });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/Row 2: no valid phone/);
    expect(r.errors[1]).toMatch(/Row 3: no usable date/);
  });
});
