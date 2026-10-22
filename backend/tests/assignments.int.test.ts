/**
 * Who dialed for whom: uploads, replacement, rollback, attribution and the daily counts, against a real Postgres.
 * Needs TEST_DATABASE_URL (an empty, UTF-8 database); without it these tests are skipped.
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

let db: typeof import("../src/db.js").db;
let svc: typeof import("../src/services/assignments.js");
let attr: typeof import("../src/services/attribution.js");
let ref: typeof import("../src/services/referenceData.js");
let sheet: typeof import("../src/rules/assignmentSheet.js");
let callRules: typeof import("../src/rules/calls.js");

const ANCHOR = "2026-10-22";
const LINE = "9990001111"; // a made-up phone line
const LINE2 = "9990002222";
const fmt = (p: string) => `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;

beforeAll(async () => {
  if (!HAS_DB) return;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  ({ db } = await import("../src/db.js"));
  svc = await import("../src/services/assignments.js");
  attr = await import("../src/services/attribution.js");
  ref = await import("../src/services/referenceData.js");
  sheet = await import("../src/rules/assignmentSheet.js");
  callRules = await import("../src/rules/calls.js");
});

afterAll(async () => {
  if (HAS_DB) await db.$disconnect();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await db.$executeRaw`TRUNCATE calls, emails, sync_runs, job_locks, agents, representatives, clients, apollo_client_map, call_timezone_rules, settings, assignment_uploads, daily_rollups RESTART IDENTITY CASCADE`;
  await ref.ensureReferenceData();
});

type Row = [string, string, string, string]; // [period, representative, client, phone]
const normalized = (rows: Row[]) => [["Date", "Representative", "Client", "Phone number"], ...rows.map(([d, r, c, p]) => [d, r, c, fmt(p)])];
const weekly = (rows: Row[]) => [["Week", "Representative", "Client", "Phone number"], ...rows.map(([d, r, c, p]) => [d, r, c, fmt(p)])];
const monthly = (rows: Row[]) => [["Month", "Representative", "Client", "Phone number"], ...rows.map(([d, r, c, p]) => [d, r, c, fmt(p)])];
const parse = (grid: unknown[][]) => sheet.parseAssignmentSheet(grid, { anchor: ANCHOR });
const commit = (grid: unknown[][], meta: Record<string, unknown> = {}) => svc.commitAssignments(parse(grid), { source: "upload", uploadedBy: "test", ...meta });

async function addCall(id: string, o: { phone: string; agent: string; shift: string; dur?: number; disp?: string | null; raw?: string | null }) {
  const agent = await db.agent.findUniqueOrThrow({ where: { key: o.agent } });
  const key = o.disp ? callRules.mapDisposition(o.disp).key : null; // the stored key (mql), not the label (MQL)
  await db.call.create({
    data: {
      id, justcallNo10: o.phone, agentId: agent.id, durationSec: o.dur ?? 10, localDate: new Date(o.shift), localTime: "12:00:00", tzUsed: "America/New_York",
      occurredAt: new Date(`${o.shift}T12:00:00Z`), shiftDate: new Date(o.shift), dispositionRaw: o.disp ? `Dispositions: ${o.disp}` : (o.raw ?? null), dispositionKey: key, raw: {},
    },
  });
}
const att = async (id: string) => {
  const a = await db.callAttribution.findUniqueOrThrow({ where: { callId: id }, include: { call: false } });
  const [client, rep] = await Promise.all([a.clientId ? db.client.findUnique({ where: { id: a.clientId } }) : null, a.representativeId ? db.representative.findUnique({ where: { id: a.representativeId } }) : null]);
  return { status: a.status, client: client?.name ?? null, rep: rep?.name ?? null, reason: a.reason };
};

describe.skipIf(!HAS_DB)("uploading the sheet", () => {
  it("previews what would change, then saves it, and calls on its lines are attributed", async () => {
    const grid = weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]);
    const p = await svc.previewAssignments(parse(grid));
    expect(p).toMatchObject({ canCommit: true, rows: 1, totals: { added: 1, removed: 0, changed: 0 } });
    expect(await db.lineAssignment.count()).toBe(0); // a preview saves nothing

    const r = await commit(grid, { fileName: "week-oct-12.xlsx" });
    expect(r.committed).toBe(true);
    await addCall("c1", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-13" });
    await addCall("c2", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-19" }); // the week ended on the 18th
    await attr.attributeCalls();
    expect(await att("c1")).toEqual({ status: "CLIENT", client: "HotChi", rep: "Phoebe", reason: "sheet" });
    expect(await att("c2")).toMatchObject({ status: "UNASSIGNED", reason: "no-assignment" });
  });

  it("uploading the same sheet again saves nothing (no double counting)", async () => {
    const grid = weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]);
    await commit(grid);
    const again = await commit(grid);
    expect(again).toMatchObject({ committed: false, noChange: true });
    expect(await db.assignmentUpload.count()).toBe(1);
    expect(await db.lineAssignment.count()).toBe(1);
  });

  it("re-uploading one week replaces only that week", async () => {
    await commit(weekly([["2026-10-05", "Phoebe", "HotChi", LINE], ["2026-10-12", "Phoebe", "HotChi", LINE]]));
    const second = weekly([["2026-10-12", "Phoebe", "Rasa", LINE]]);
    const p = await svc.previewAssignments(parse(second));
    expect(p.periods).toHaveLength(1);
    expect(p.totals).toMatchObject({ changed: 1, added: 0, removed: 0 });
    expect(p.periods[0].examples.changed[0]).toMatch(/HotChi.*->.*Rasa/);
    await commit(second);

    await addCall("old", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-06" });
    await addCall("new", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-14" });
    await attr.attributeCalls();
    expect((await att("old")).client).toBe("HotChi"); // the week of Oct 5 was not touched
    expect((await att("new")).client).toBe("Rasa");
  });

  it("a number that disappears from a re-uploaded week is removed from that week", async () => {
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE], ["2026-10-12", "Phoebe", "HotChi", LINE2]]));
    const p = await svc.previewAssignments(parse(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]])));
    expect(p.totals).toMatchObject({ removed: 1, added: 0 });
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    expect((await svc.loadActiveAssignments()).map((a) => a.phoneNo10)).toEqual([LINE]);
  });

  it("weekly, monthly and daily rows: the most specific one wins, and a daily upload leaves earlier days alone", async () => {
    await commit(monthly([["October 2026", "Phoebe", "Cedar's", LINE]]));
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    await commit(normalized([["2026-10-19", "Phoebe", "Rasa", LINE]])); // the daily upload after Oct 18
    for (const [id, day] of [["wk", "2026-10-15"], ["sun", "2026-10-18"], ["d19", "2026-10-19"], ["d20", "2026-10-20"], ["early", "2026-10-03"]]) {
      await addCall(id, { phone: LINE, agent: "purbasha sarkar", shift: day });
    }
    await attr.attributeCalls();
    expect((await att("wk")).client).toBe("HotChi"); // the week
    expect((await att("sun")).client).toBe("HotChi"); // the last day of the week
    expect((await att("d19")).client).toBe("Rasa"); // the daily row
    expect((await att("d20")).client).toBe("Cedar's"); // back to the month
    expect((await att("early")).client).toBe("Cedar's");
    // the next day's daily upload does not disturb the first
    await commit(normalized([["2026-10-20", "Phoebe", "HotChi", LINE]]));
    await attr.attributeCalls();
    expect((await att("d19")).client).toBe("Rasa");
    expect((await att("d20")).client).toBe("HotChi");
  });

  it("a rollback brings back what the upload replaced, and the calls follow", async () => {
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    const second = await commit(weekly([["2026-10-12", "Phoebe", "Rasa", LINE]]));
    if (!second.committed) throw new Error("expected a commit");
    await addCall("c", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-14" });
    await attr.attributeCalls();
    expect((await att("c")).client).toBe("Rasa");

    const rb = await svc.rollbackUpload(second.uploadId, "test");
    expect(rb.range).toMatchObject({ from: "2026-10-12" });
    await attr.attributeCalls();
    expect((await att("c")).client).toBe("HotChi");
    await expect(svc.rollbackUpload(second.uploadId)).rejects.toThrow(/already rolled back/);
    // rolling back the first one too leaves nothing
    const first = await db.assignmentUpload.findFirstOrThrow({ orderBy: { id: "asc" } });
    await svc.rollbackUpload(first.id);
    await attr.attributeCalls();
    expect((await att("c")).status).toBe("UNASSIGNED");
  });

  it("an unknown Representative or client, or one line on two clients in the same week, blocks the upload", async () => {
    await expect(commit(weekly([["2026-10-12", "Nobody", "HotChi", LINE]]))).rejects.toThrow(/Unknown Representative "Nobody"/);
    await expect(commit(weekly([["2026-10-12", "Phoebe", "Nowhere", LINE]]))).rejects.toThrow(/Unknown client "Nowhere"/);
    await expect(commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE], ["2026-10-12", "Kevin", "Rasa", LINE]]))).rejects.toThrow(/two clients/);
    expect(await db.assignmentUpload.count()).toBe(0); // nothing was saved
    expect(await db.lineAssignment.count()).toBe(0);
  });

  it("a sheet may name the real person (the agent); it is stored under the Representative", async () => {
    await commit(weekly([["2026-10-12", "Purbasha Sarkar", "HotChi", LINE]]));
    expect((await svc.loadActiveAssignments())[0]).toMatchObject({ repName: "Phoebe", clientName: "HotChi" });
  });

  it("curly apostrophes in a client name still match (Cedar’s)", async () => {
    await commit(weekly([["2026-10-12", "Phoebe", "Cedar’s", LINE]]));
    expect((await svc.loadActiveAssignments())[0].clientName).toBe("Cedar's");
  });

  it("warns, without blocking, about a shared line and about numbers that swap clients", async () => {
    const shared = await svc.previewAssignments(parse(weekly([["2026-10-12", "Dave", "Rasa", LINE], ["2026-10-12", "Hiya", "Rasa", LINE]])));
    expect(shared.canCommit).toBe(true);
    expect(shared.warnings.join(" ")).toMatch(/shared by Dave and Hiya/);

    await commit(weekly([["2026-09-21", "Andrew", "Rasa", LINE], ["2026-09-21", "Andrew", "Kati Roll", LINE2]]));
    const swap = await svc.previewAssignments(parse(weekly([["2026-09-28", "Andrew", "Kati Roll", LINE], ["2026-09-28", "Andrew", "Rasa", LINE2]])));
    expect(swap.canCommit).toBe(true);
    expect(swap.warnings.join(" ")).toMatch(/Possible mix-up: Andrew/);
    await commit(weekly([["2026-09-28", "Andrew", "Kati Roll", LINE], ["2026-09-28", "Andrew", "Rasa", LINE2]]));
    // a later, unrelated upload is not nagged about the old mix-up
    const unrelated = await svc.previewAssignments(parse(normalized([["2026-10-19", "Phoebe", "HotChi", "9990003333"]])));
    expect(unrelated.warnings.join(" ")).not.toMatch(/mix-up/);
  });
});

describe.skipIf(!HAS_DB)("which Representative a call belongs to", () => {
  it("a line listed for two Representatives is attributed by the agent; an agent with no Representative is flagged", async () => {
    await commit(weekly([["2026-10-12", "Dave", "Rasa", LINE], ["2026-10-12", "Hiya", "Rasa", LINE]]));
    await addCall("d", { phone: LINE, agent: "dave som", shift: "2026-10-13" });
    await addCall("h", { phone: LINE, agent: "hiya dutta", shift: "2026-10-13" });
    await db.agent.create({ data: { key: "new person", name: "New Person" } });
    await addCall("x", { phone: LINE, agent: "new person", shift: "2026-10-13" });
    await attr.attributeCalls();
    expect(await att("d")).toMatchObject({ status: "CLIENT", rep: "Dave", reason: "shared-line-by-agent" });
    expect(await att("h")).toMatchObject({ status: "CLIENT", rep: "Hiya", reason: "shared-line-by-agent" });
    expect(await att("x")).toMatchObject({ status: "CONFLICT", client: null });
  });

  it("a line assigned to Kutlerri is Internal and is not counted in the daily numbers", async () => {
    await commit(weekly([["2026-10-12", "Arman Agrawal", "Kutlerri", LINE]]));
    await addCall("i", { phone: LINE, agent: "arman agrawal", shift: "2026-10-13" });
    await attr.attributeAndRollup();
    expect((await att("i")).status).toBe("INTERNAL");
    expect(await db.dailyRollup.count()).toBe(0);
  });

  it("standing fallbacks fill gaps but never beat a sheet row", async () => {
    await svc.commitAssignments(
      parse(normalized([["2026-08-17", "Arman Agrawal", "Kutlerri", LINE]]).map((r, i) => (i === 0 ? ["Valid from", "Representative", "Client", "Phone number"] : r))),
      { source: "override", priority: 0, uploadedBy: "test" },
    );
    await addCall("a", { phone: LINE, agent: "arman agrawal", shift: "2026-10-13" });
    await attr.attributeCalls();
    expect(await att("a")).toMatchObject({ status: "INTERNAL", reason: "fallback" });
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    await attr.attributeCalls();
    expect(await att("a")).toMatchObject({ status: "CLIENT", client: "HotChi", reason: "sheet" });
  });

  describe("calls on a line that is not on the sheet", () => {
    const setup = async () => {
      // David has Rasa (LINE) and Eight Turn Crepe (LINE2); on the 13th he only dialed on the Rasa line
      await commit(weekly([["2026-10-12", "David", "Rasa", LINE], ["2026-10-12", "David", "Eight Turn Crepe", LINE2]]));
      await addCall("listed", { phone: LINE, agent: "debrup ghosh", shift: "2026-10-13" });
      await addCall("unlisted", { phone: "9990009999", agent: "debrup ghosh", shift: "2026-10-13" });
      await addCall("other-day", { phone: "9990009999", agent: "debrup ghosh", shift: "2026-10-14" });
      await addCall("excluded", { phone: "3464233909", agent: "debrup ghosh", shift: "2026-10-13" });
    };
    it("go to the Representative's client for that day when it is clear", async () => {
      await setup();
      await attr.attributeCalls();
      expect(await att("unlisted")).toMatchObject({ status: "CLIENT", client: "Rasa", rep: "David", reason: "agent-fallback" });
      // on the 14th David dialed nothing listed, and the sheet gives him two customer clients: not guessed
      expect((await att("other-day")).status).toBe("UNASSIGNED");
    });
    it("never for the lines that are meant to stay Unassigned", async () => {
      await setup();
      await attr.attributeCalls();
      expect((await att("excluded")).status).toBe("UNASSIGNED");
    });
    it("not at all when the setting is off", async () => {
      await setup();
      await db.setting.update({ where: { key: "agentFallback" }, data: { value: false } });
      await attr.attributeCalls();
      expect((await att("unlisted")).status).toBe("UNASSIGNED");
      expect((await att("listed")).status).toBe("CLIENT");
    });
  });

  it("attribution is repeatable: a second run rewrites nothing", async () => {
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    await addCall("c", { phone: LINE, agent: "purbasha sarkar", shift: "2026-10-13" });
    expect((await attr.attributeCalls()).changed).toBe(1);
    expect((await attr.attributeCalls()).changed).toBe(0);
  });
});

describe.skipIf(!HAS_DB)("daily counts", () => {
  const seedCalls = async () => {
    await commit(weekly([["2026-10-12", "Phoebe", "HotChi", LINE]]));
    const a = "purbasha sarkar";
    await addCall("1", { phone: LINE, agent: a, shift: "2026-10-13", dur: 120, disp: "MQL" }); // mql over 90, a connect over 90
    await addCall("2", { phone: LINE, agent: a, shift: "2026-10-13", dur: 90, disp: "MQL" }); // exactly 90: not meaningful
    await addCall("3", { phone: LINE, agent: a, shift: "2026-10-13", dur: 200, disp: "MQL Follow-Up" }); // a connect, but not an MQL
    await addCall("4", { phone: LINE, agent: a, shift: "2026-10-13", dur: 0, disp: "No Answer" });
    await addCall("5", { phone: LINE, agent: a, shift: "2026-10-13", dur: 5, disp: null }); // no disposition
    await addCall("6", { phone: LINE, agent: a, shift: "2026-10-13", dur: 5, raw: "Dispositions: Brand New" }); // unknown text
    await addCall("7", { phone: LINE, agent: a, shift: "2026-10-14", dur: 40, disp: "Left Voicemail" });
  };
  const day = async (d: string) => (await db.dailyRollup.findMany({ where: { shiftDate: new Date(d) } }))[0];

  it("counts calls, connects, meaningful conversations and MQLs by the rules", async () => {
    await seedCalls();
    await attr.attributeAndRollup();
    const r = await day("2026-10-13");
    expect(r).toMatchObject({ calls: 6, meaningful: 2, mqlOver90: 1, dMql: 2, dMqlFu: 1, dNoAnswer: 1, dBlank: 1, dOther: 1 });
  });

  it("rebuilding twice, or for a different range, changes nothing else", async () => {
    await seedCalls();
    await attr.attributeAndRollup();
    const before = await db.dailyRollup.findMany({ orderBy: { id: "asc" } });
    await attr.rebuildRollups("2026-10-13", "2026-10-13");
    await attr.rebuildRollups("2026-10-13", "2026-10-13");
    const after = await db.dailyRollup.findMany({ where: { shiftDate: new Date("2026-10-13") } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ calls: 6 });
    expect(await db.dailyRollup.count()).toBe(before.length); // the 14th is still there
    expect((await day("2026-10-14")).dVoicemail).toBe(1);
  });

  it("follows a change of assignment: replacing the week moves the counts to the other client", async () => {
    await seedCalls();
    await attr.attributeAndRollup();
    await commit(weekly([["2026-10-12", "Phoebe", "Rasa", LINE]]));
    await attr.attributeAndRollup("2026-10-12", "2026-10-18");
    const rows = await db.dailyRollup.findMany({ include: undefined });
    const clients = await db.client.findMany();
    const name = (id: number) => clients.find((c) => c.id === id)!.name;
    expect(new Set(rows.map((r) => name(r.clientId)))).toEqual(new Set(["Rasa"]));
  });
});
