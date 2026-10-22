import { describe, expect, it } from "vitest";
import { resolveCallZone, shiftDate, toUtc, ZONES, eachDay, dateInZone, type TzRule } from "../src/rules/time.js";
import { isConnect, isMeaningful, isMqlOver90, last10, mapDisposition, agentKey } from "../src/rules/calls.js";
import { resolveEmailClient, senderDomain, type EmailRule } from "../src/rules/emails.js";

const ET = ZONES.eastern;
const ist = (utc: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONES.ist, dateStyle: "short", timeStyle: "medium", hour12: false }).format(utc);

describe("provider time to UTC and IST", () => {
  it("converts US Eastern summer time to IST (+9h30)", () => {
    const utc = toUtc("2026-10-09", "14:17:46", ET);
    expect(utc.toISOString()).toBe("2026-10-09T18:17:46.000Z");
    expect(ist(utc)).toBe("09/10/2026, 23:47:46"); // matches the prototype's workbook for the same call
  });
  it("switches to +10h30 after the US clock change on 1 Nov 2026", () => {
    expect(toUtc("2026-10-31", "12:00:00", ET).toISOString()).toBe("2026-10-31T16:00:00.000Z"); // EDT, UTC-4
    expect(toUtc("2026-11-02", "12:00:00", ET).toISOString()).toBe("2026-11-02T17:00:00.000Z"); // EST, UTC-5
  });
  it("handles the repeated hour (takes the first) and the skipped hour (moves forward)", () => {
    expect(toUtc("2026-11-01", "01:30:00", ET).toISOString()).toBe("2026-11-01T05:30:00.000Z"); // first 1:30, EDT
    expect(toUtc("2026-03-08", "02:30:00", ET).toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 2:30 does not exist
  });
  it("accepts times without seconds and rejects nonsense", () => {
    expect(toUtc("2026-10-09", "14:17", ET).toISOString()).toBe("2026-10-09T18:17:00.000Z");
    expect(() => toUtc("2026-13-45", "14:17:46", ET)).toThrow();
    expect(() => toUtc("2026-10-09", "25:00:00", ET)).toThrow();
  });
});

describe("shift day (5 PM IST to just before 5 PM IST the next day)", () => {
  const at = (iso: string) => new Date(iso); // the ISO strings below carry an explicit +05:30
  it("4:59 PM belongs to the previous day, 5:00 PM starts the new one", () => {
    expect(shiftDate(at("2026-10-09T16:59:59+05:30"))).toBe("2026-10-08");
    expect(shiftDate(at("2026-10-09T17:00:00+05:30"))).toBe("2026-10-09");
  });
  it("a call at 12:30 AM belongs to the day the shift started", () => {
    expect(shiftDate(at("2026-10-10T00:30:00+05:30"))).toBe("2026-10-09");
  });
  it("covers the whole evening and the early hours", () => {
    expect(shiftDate(at("2026-10-09T18:30:00+05:30"))).toBe("2026-10-09");
    expect(shiftDate(at("2026-10-09T23:59:59+05:30"))).toBe("2026-10-09");
    expect(shiftDate(at("2026-10-10T04:59:59+05:30"))).toBe("2026-10-09");
    expect(shiftDate(at("2026-10-10T16:59:59+05:30"))).toBe("2026-10-09"); // rare daytime call: still the previous shift
  });
  it("end to end from an Eastern call", () => {
    // 15:34 Eastern on Oct 8 = 1:04 AM IST on Oct 9 = the Oct 8 shift
    expect(shiftDate(toUtc("2026-10-08", "15:34:30", ET))).toBe("2026-10-08");
    // 07:45 Eastern = 5:15 PM IST the same day = starts the Oct 9 shift
    expect(shiftDate(toUtc("2026-10-09", "07:45:00", ET))).toBe("2026-10-09");
  });
});

describe("time zone rules (agents whose JustCall clock differs)", () => {
  const rules: TzRule[] = [
    { agentKey: "abby wilson", zone: "America/Chicago", validFrom: "2026-09-28" },
    { agentKey: "andrew robert", zone: "UTC-3", validFrom: "2026-09-08" },
    { lineNo10: "5715002756", zone: "America/Denver", validFrom: "2026-10-01", validTo: "2026-10-05" },
  ];
  it("uses the default zone when no rule applies", () => {
    expect(resolveCallZone(rules, { agentKey: "hiya dutta", localDate: "2026-10-09" }, ET)).toBe(ET);
  });
  it("applies a rule only from its start date", () => {
    expect(resolveCallZone(rules, { agentKey: "abby wilson", localDate: "2026-09-27" }, ET)).toBe(ET);
    expect(resolveCallZone(rules, { agentKey: "abby wilson", localDate: "2026-09-28" }, ET)).toBe("America/Chicago");
  });
  it("honours an end date and a line rule", () => {
    const who = { agentKey: "someone else", lineNo10: "5715002756" };
    expect(resolveCallZone(rules, { ...who, localDate: "2026-10-05" }, ET)).toBe("America/Denver");
    expect(resolveCallZone(rules, { ...who, localDate: "2026-10-06" }, ET)).toBe(ET);
  });
  it("a fixed offset zone works, and Central is one hour earlier than Eastern for the same wall clock", () => {
    expect(toUtc("2026-10-09", "12:00:00", "UTC-3").toISOString()).toBe("2026-10-09T15:00:00.000Z");
    const central = toUtc("2026-10-09", "16:05:18", "America/Chicago");
    expect(ist(central)).toBe("10/10/2026, 02:35:18"); // the workbook's time for call 424380682
  });
  it("the most specific rule wins", () => {
    const both: TzRule[] = [...rules, { agentKey: "abby wilson", lineNo10: "9999999999", zone: "Asia/Tokyo", validFrom: "2026-09-01" }];
    expect(resolveCallZone(both, { agentKey: "abby wilson", lineNo10: "9999999999", localDate: "2026-10-01" }, ET)).toBe("Asia/Tokyo");
  });
});

describe("dispositions", () => {
  it.each([
    ["Dispositions: MQL", "mql"],
    ["Dispositions: Interested But Follow Up Needed", "interested"],
    ["Dispositions: Call Back Later", "callback"],
    ["Dispositions: Not Interested", "not_interested"],
    ["Dispositions: Wrong Number", "wrong_number"],
    ["Dispositions: MQL Follow-Up", "mql_fu"],
    ["Dispositions: Do Not Call Again", "dnc"],
    ["Dispositions: No Answer", "no_answer"],
    ["Dispositions: Bad Number", "bad_number"],
    ["Dispositions: Left Voicemail", "voicemail"],
    ["Dispositions: Meeting Set", "meeting"],
    ["  dispositions:   mql   follow-up ", "mql_fu"],
  ])("%s -> %s", (raw, key) => expect(mapDisposition(raw)).toEqual({ key, unknown: false }));
  it("no disposition is not unknown; a new text is reported rather than guessed", () => {
    expect(mapDisposition(null)).toEqual({ key: null, unknown: false });
    expect(mapDisposition("")).toEqual({ key: null, unknown: false });
    expect(mapDisposition("Dispositions: Something New")).toEqual({ key: null, unknown: true });
  });
  it("MQL means mql only, never mql_fu", () => {
    expect(isMqlOver90("mql", 91)).toBe(true);
    expect(isMqlOver90("mql_fu", 500)).toBe(false);
  });
  it("90 seconds exactly is not a meaningful conversation; 91 is", () => {
    expect(isMeaningful("interested", 90)).toBe(false);
    expect(isMeaningful("interested", 91)).toBe(true);
    expect(isMqlOver90("mql", 90)).toBe(false);
  });
  it("voicemail, meeting, no answer and no disposition are not connects", () => {
    for (const k of ["voicemail", "meeting", "no_answer", "bad_number", null]) expect(isConnect(k)).toBe(false);
    expect(isMeaningful("no_answer", 600)).toBe(false);
  });
});

describe("phone numbers and agents", () => {
  it("keeps the last 10 digits", () => {
    expect(last10("(571) 500-2756")).toBe("5715002756");
    expect(last10("+1 571 500 2756")).toBe("5715002756");
    expect(last10("15715002756")).toBe("5715002756");
    expect(last10(null)).toBeNull();
    expect(last10("n/a")).toBeNull();
  });
  it("agent names match regardless of casing and spacing", () => {
    expect(agentKey("krissh singh")).toBe(agentKey("  Krissh   Singh "));
  });
});

describe("email to client", () => {
  const rules: EmailRule[] = [
    { kind: "domain", value: "rasacatering.co", clientId: 1 },
    { kind: "domain", value: "rasa.co", clientId: 1 },
    { kind: "domain", value: "hotchicatering.net", clientId: 4 },
    { kind: "domain", value: "kutlerricorp.com", clientId: 99 },
    { kind: "mailbox", value: "special@hotchicatering.net", clientId: 1 },
    { kind: "sequence", value: "gyro halloween", clientId: 3 },
  ];
  it("the sender domain decides", () => {
    expect(resolveEmailClient(rules, { from: "Alex@RasaCatering.co", sequence: null })).toBe(1);
    expect(resolveEmailClient(rules, { from: "x@rasa.co", sequence: null })).toBe(1);
    expect(resolveEmailClient(rules, { from: "x@hotchicatering.net", sequence: null })).toBe(4);
  });
  it("a mailbox or sequence rule beats the domain", () => {
    expect(resolveEmailClient(rules, { from: "special@hotchicatering.net", sequence: null })).toBe(1);
    expect(resolveEmailClient(rules, { from: "x@hotchicatering.net", sequence: "Gyro Halloween" })).toBe(3);
  });
  it("unknown senders are not guessed", () => {
    expect(resolveEmailClient(rules, { from: "x@unknown.com", sequence: null })).toBeNull();
    expect(resolveEmailClient(rules, { from: null, sequence: null })).toBeNull();
    expect(senderDomain("nonsense")).toBeNull();
  });
});

describe("dates", () => {
  it("Apollo's date is Pacific time with daylight saving (UTC-7 in October)", () => {
    expect(dateInZone(new Date("2026-10-09T06:30:00Z"), ZONES.pacific)).toBe("2026-10-08"); // 11:30 PM PDT on the 8th
    expect(dateInZone(new Date("2026-10-09T07:00:00Z"), ZONES.pacific)).toBe("2026-10-09"); // midnight PDT
  });
  it("lists every day in a range", () => {
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});
