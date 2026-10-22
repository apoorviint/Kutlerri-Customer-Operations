/**
 * Ingestion against a real Postgres and a fake call-logs API. Needs TEST_DATABASE_URL (an empty, UTF-8 database);
 * without it these tests are skipped.
 */
import { createServer, type Server } from "node:http";
import { execSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

type Item = Record<string, unknown>;
const fake = {
  calls: [] as Item[],
  emails: [] as Item[],
  requests: [] as { path: string; from?: string; to?: string; perPage: number; page: number }[],
  // simulate the real API's flaw: on one page a row is repeated while another goes missing
  delayMs: 0,
  faulty: null as null | ((path: string, perPage: number, page: number, items: Item[], all: Item[]) => Item[]),
};

const callItem = (id: number, o: Item = {}): Item => ({
  id, contact_no: "18447812365", justcall_no: "17733986668", justcall_no_name: "Phoebe_Chicago(2)", agent_name: "Purbasha Sarkar",
  recording_url: `https://example.com/rec/${id}`, duration: 42, date: "2026-10-09", time: "14:17:46", disposition_code: null,
  synced_at: "2026-10-10T00:00:00.000000Z", ...o,
});
const emailItem = (id: string, o: Item = {}): Item => ({
  apollo_message_id: id, sequence: "RASA_campaigns for Event", sequence_id: "s1", step: 1, template: "t", from_email: "alex@rasacatering.co",
  to_email: "buyer@example.com", from_name: "Alex", to_name: "Buyer", subject: "Hello", body_html: null, sent_at: "2026-10-09T06:30:00.000Z",
  scheduled_at: "2026-10-09T06:29:00.000Z", cc: null, bcc: null, sent: true, bounce: false, open: false, click: false, unsubscribe: false,
  replied: false, contact_id: "c1", account_id: "a1", to_company: "Acme", contact_stage: "Approaching", synced_at: "2026-10-10T00:00:00.000000Z", ...o,
});

let server: Server;
let db: typeof import("../src/db.js").db;
let jobs: typeof import("../src/services/jobs.js");
let ref: typeof import("../src/services/referenceData.js");

const dayOf = (it: Item) => String(it.date ?? String(it.sent_at).slice(0, 10));

beforeAll(async () => {
  if (!HAS_DB) return;
  server = createServer((req, res) => {
    const u = new URL(req.url!, "http://x");
    const path = u.pathname;
    const all = path === "/v1/calls" ? fake.calls : path === "/v1/emails" ? fake.emails : null;
    if (!all) { res.statusCode = 404; return void res.end("{}"); }
    const perPage = Number(u.searchParams.get("per_page") ?? 50), page = Number(u.searchParams.get("page") ?? 1);
    const from = u.searchParams.get("date_from") ?? undefined, to = u.searchParams.get("date_to") ?? undefined;
    fake.requests.push({ path, from, to, perPage, page });
    const rows = all.filter((it) => (!from || dayOf(it) >= from) && (!to || dayOf(it) <= to));
    let items = rows.slice((page - 1) * perPage, page * perPage);
    if (fake.faulty) items = fake.faulty(path, perPage, page, items, rows);
    res.setHeader("content-type", "application/json");
    setTimeout(() => res.end(JSON.stringify({ items, total: rows.length, page, per_page: perPage })), fake.delayMs);
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.CALL_LOGS_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  ({ db } = await import("../src/db.js"));
  jobs = await import("../src/services/jobs.js");
  ref = await import("../src/services/referenceData.js");
});

afterAll(async () => {
  if (!HAS_DB) return;
  await db.$disconnect();
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  if (!HAS_DB) return;
  // a clean slate every time, so one test's edits to rules or agents can never leak into the next
  await db.$executeRaw`TRUNCATE calls, emails, sync_runs, job_locks, agents, representatives, clients, apollo_client_map, call_timezone_rules, settings RESTART IDENTITY CASCADE`;
  await ref.ensureReferenceData();
  Object.assign(fake, { calls: [], emails: [], requests: [], faulty: null, delayMs: 0 });
});

const lastRun = (source: string) => db.syncRun.findFirstOrThrow({ where: { source }, orderBy: { startedAt: "desc" } });

describe.skipIf(!HAS_DB)("calls", () => {
  it("stores calls with the provider's time, the UTC instant, the IST shift day, the agent and the disposition", async () => {
    fake.calls = [
      callItem(1, { disposition_code: "Dispositions: MQL", duration: 120 }),
      callItem(2, { agent_name: "krissh singh", time: "07:45:00", disposition_code: "Dispositions: Interested But Follow Up Needed" }),
      callItem(3, { agent_name: "Abby Wilson", date: "2026-09-30", time: "16:05:18" }), // Central-time agent (rule from 28 Sep)
    ];
    const r = await jobs.runJob("calls", { from: "2026-09-30", to: "2026-10-09" });
    expect(r.status).toBe("ok");
    const rows = await db.$queryRaw<any[]>`
      SELECT c.id, c.tz_used, c.occurred_at, to_char(c.shift_date,'YYYY-MM-DD') AS shift, c.disposition_key, c.contact_no10, c.justcall_no10,
             a.key AS agent, rep.name AS rep
      FROM calls c LEFT JOIN agents a ON a.id = c.agent_id LEFT JOIN representatives rep ON rep.id = a.representative_id ORDER BY c.id`;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ tz_used: "America/New_York", shift: "2026-10-09", disposition_key: "mql", contact_no10: "8447812365", justcall_no10: "7733986668", rep: "Phoebe" });
    expect(rows[0].occurred_at.toISOString()).toBe("2026-10-09T18:17:46.000Z"); // 14:17:46 Eastern = 23:47:46 IST = late in the shift that started at 5 PM IST on Oct 9
    expect(rows[1]).toMatchObject({ agent: "krissh singh", rep: "Kevin", disposition_key: "interested", shift: "2026-10-09" }); // 07:45 ET = 5:15 PM IST
    expect(rows[2]).toMatchObject({ tz_used: "America/Chicago", rep: "Abby Wilson" });
    expect(rows[2].occurred_at.toISOString()).toBe("2026-09-30T21:05:18.000Z");
  });

  it("running it again changes nothing: no duplicates, nothing rewritten", async () => {
    fake.calls = [callItem(1), callItem(2), callItem(3, { time: "09:00:00" })];
    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    const first = await lastRun("calls");
    expect(first).toMatchObject({ inserted: 3, updated: 0 });
    const before = await db.$queryRaw<any[]>`SELECT id, updated_at FROM calls ORDER BY id`;

    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    expect(await db.call.count()).toBe(3);
    expect(await lastRun("calls")).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, status: "ok" });
    const after = await db.$queryRaw<any[]>`SELECT id, updated_at FROM calls ORDER BY id`;
    expect(after.map((r) => r.updated_at.getTime())).toEqual(before.map((r) => r.updated_at.getTime()));
  });

  it("a changed call (a disposition added later) is updated in place", async () => {
    fake.calls = [callItem(1), callItem(2)];
    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    fake.calls[0] = callItem(1, { disposition_code: "Dispositions: Call Back Later", duration: 200 });
    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    expect(await db.call.count()).toBe(2);
    expect(await lastRun("calls")).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await db.call.findUniqueOrThrow({ where: { id: "1" } })).toMatchObject({ dispositionKey: "callback", durationSec: 200 });
  });

  it("loses no rows when the API repeats one row and skips another on a page boundary", async () => {
    // 1,200 calls in one day, all in the same few seconds (lots of ties), like the real data
    fake.calls = Array.from({ length: 1200 }, (_, i) => callItem(1000 + i, { time: `10:00:${String(i % 3).padStart(2, "0")}` }));
    fake.faulty = (path, perPage, page, items, all) => {
      if (perPage === 500 && page === 2) return [...items.slice(0, -1), all[0]]; // repeat row 1, lose the last row of page 2
      return items;
    };
    const r = await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    expect(await db.call.count()).toBe(1200);
    expect(r.status).toBe("ok");
    const run = await lastRun("calls");
    expect((run.details as any).daysWithRetries).toBe(1);
    expect(fake.requests.some((q) => q.perPage === 499)).toBe(true);
  });

  it("reports (does not hide) rows it still cannot get after retrying", async () => {
    fake.calls = Array.from({ length: 700 }, (_, i) => callItem(i + 1));
    fake.faulty = (_p, _pp, _page, items) => items.filter((i) => i.id !== 350); // row 350 never arrives, whatever the page size
    const r = await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    expect(r.status).toBe("warning");
    expect((await lastRun("calls")).error).toMatch(/received 699 of 700/);
  });

  it("a new agent name is stored and waits for an admin to map it to a Representative", async () => {
    fake.calls = [callItem(1, { agent_name: "New Person" })];
    await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    const agent = await db.agent.findUniqueOrThrow({ where: { key: "new person" } });
    expect(agent.representativeId).toBeNull();
  });

  it("an unrecognised disposition and an unreadable row are reported, and the good rows are still stored", async () => {
    fake.calls = [callItem(1), callItem(2, { disposition_code: "Dispositions: Brand New Outcome" }), callItem(3, { time: "99:99:99" })];
    const r = await jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" });
    expect(r.status).toBe("warning");
    expect(await db.call.count()).toBe(2); // the row with an impossible time cannot be stored
    const run = await lastRun("calls");
    expect(run.skipped).toBe(1);
    expect(run.error).toMatch(/1 rows could not be read/);
    expect(run.error).toMatch(/Brand New Outcome/);
    const two = await db.call.findUniqueOrThrow({ where: { id: "2" } });
    expect(two.dispositionKey).toBeNull(); // not guessed
    expect(two.dispositionRaw).toBe("Dispositions: Brand New Outcome"); // but kept, so it can be mapped later
  });

  it("never reads anything before the start date", async () => {
    fake.calls = [callItem(1, { date: "2026-08-10" }), callItem(2, { date: "2026-08-17" })];
    await jobs.runJob("calls", { from: "2026-08-01", to: "2026-08-18" });
    expect(Math.min(...fake.requests.map((q) => Date.parse(q.from!)))).toBe(Date.parse("2026-08-17"));
    expect((await db.call.findMany()).map((c) => c.id)).toEqual(["2"]);
  });

  it("with no range given, it starts two days before the newest stored call (and from the start date when empty)", async () => {
    fake.calls = [callItem(1, { date: "2026-10-09" })];
    await jobs.runJob("calls"); // empty database: everything from the start date
    expect(fake.requests[0].from).toBe("2026-08-17");
    fake.requests.length = 0;
    await jobs.runJob("calls");
    expect(fake.requests[0].from).toBe("2026-10-07");
  });

  it("the same job never runs twice at once", async () => {
    fake.calls = Array.from({ length: 50 }, (_, i) => callItem(i + 1));
    fake.delayMs = 400; // the first run is still busy when the second one starts
    const [a, b] = await Promise.all([jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" }), jobs.runJob("calls", { from: "2026-10-09", to: "2026-10-09" })]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(await db.call.count()).toBe(50);
  });

  it("changing a time zone rule re-applies to stored calls without fetching anything again", async () => {
    fake.calls = [callItem(1, { agent_name: "Abby Wilson", date: "2026-10-01", time: "16:00:00" }), callItem(2, { date: "2026-10-01", time: "16:00:00" })];
    await jobs.runJob("calls", { from: "2026-10-01", to: "2026-10-01" });
    expect((await db.call.findUniqueOrThrow({ where: { id: "1" } })).tzUsed).toBe("America/Chicago");
    fake.requests.length = 0;
    await db.callTimezoneRule.updateMany({ where: { agentKey: "abby wilson" }, data: { zone: "America/New_York" } });
    await jobs.runJob("recompute-call-times");
    expect(fake.requests).toHaveLength(0);
    expect(await lastRun("recompute-call-times")).toMatchObject({ fetched: 2, updated: 1 });
    expect(await db.call.findUniqueOrThrow({ where: { id: "1" } })).toMatchObject({ tzUsed: "America/New_York" });
    // 16:00 Eastern = 1:30 AM IST on Oct 2 = still the Oct 1 shift
    expect((await db.call.findUniqueOrThrow({ where: { id: "1" } })).shiftDate.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
});

describe.skipIf(!HAS_DB)("emails", () => {
  it("matches the client by sender domain, keeps Kutlerri's own emails apart, and leaves unknown senders unmapped", async () => {
    fake.emails = [
      emailItem("m1"),
      emailItem("m2", { from_email: "sam@rasa.co" }),
      emailItem("m3", { from_email: "x@hotchicatering.net", sequence: "HotChi Nurture" }),
      emailItem("m4", { from_email: "me@kutlerricorp.com" }),
      emailItem("m5", { from_email: "who@unknown.org" }),
    ];
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    const rows = await db.$queryRaw<any[]>`
      SELECT e.id, cl.name AS client, cl.kind FROM emails e LEFT JOIN clients cl ON cl.id = e.client_id ORDER BY e.id`;
    expect(rows.map((r) => [r.id, r.client])).toEqual([["m1", "Rasa"], ["m2", "Rasa"], ["m3", "HotChi"], ["m4", "Kutlerri"], ["m5", null]]);
    expect(rows[3].kind).toBe("INTERNAL");
  });

  it("uses Apollo's Pacific date: 11:30 PM on Oct 8 Pacific is Oct 9 in UTC but still Oct 8", async () => {
    fake.emails = [emailItem("m1", { sent_at: "2026-10-09T06:30:00.000Z" }), emailItem("m2", { sent_at: "2026-10-09T07:00:00.000Z" })];
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    const rows = await db.$queryRaw<any[]>`SELECT id, to_char(sent_date_pacific,'YYYY-MM-DD') AS d FROM emails ORDER BY id`;
    expect(rows.map((r) => r.d)).toEqual(["2026-10-08", "2026-10-09"]);
  });

  it("is repeatable, and an email that was later opened or replied to is updated in place", async () => {
    fake.emails = [emailItem("m1"), emailItem("m2")];
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    expect(await db.email.count()).toBe(2);
    expect(await lastRun("emails")).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    fake.emails[0] = emailItem("m1", { open: true, replied: true });
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    expect(await db.email.count()).toBe(2);
    expect(await lastRun("emails")).toMatchObject({ updated: 1 });
    expect(await db.email.findUniqueOrThrow({ where: { id: "m1" } })).toMatchObject({ opened: true, replied: true });
  });

  it("an email without a sent time is stored but not counted as sent", async () => {
    fake.emails = [emailItem("m1", { sent_at: null, sent: true })];
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    // the fake filters by sent_at, so a null sent_at never matches a date window; the mapping rule is covered here directly
    const { mapEmail } = await import("../src/services/ingestEmails.js");
    const { loadSettings } = await import("../src/services/settings.js");
    const row = mapEmail(emailItem("m9", { sent_at: null, sent: true }), { settings: await loadSettings(), rules: await ref.loadEmailRules() });
    expect(row.sent).toBe(false);
    expect(row.sentDatePacific).toBeNull();
  });

  it("changing an email rule re-applies to stored emails", async () => {
    fake.emails = [emailItem("m1", { from_email: "x@newdomain.com" })];
    await jobs.runJob("emails", { from: "2026-10-09", to: "2026-10-09" });
    expect((await db.email.findUniqueOrThrow({ where: { id: "m1" } })).clientId).toBeNull();
    const cedars = await db.client.findUniqueOrThrow({ where: { name: "Cedar's" } });
    await db.apolloClientRule.create({ data: { kind: "domain", value: "newdomain.com", clientId: cedars.id } });
    await jobs.runJob("recompute-email-clients");
    expect((await db.email.findUniqueOrThrow({ where: { id: "m1" } })).clientId).toBe(cedars.id);
  });
});

describe.skipIf(!HAS_DB)("reference data", () => {
  it("is added only when missing, so an admin's edits are never overwritten", async () => {
    const hotchi = await db.client.findUniqueOrThrow({ where: { name: "HotChi" } });
    await db.apolloClientRule.update({ where: { kind_value: { kind: "domain", value: "hotchicatering.net" } }, data: { clientId: (await db.client.findUniqueOrThrow({ where: { name: "Rasa" } })).id } });
    await ref.ensureReferenceData();
    expect((await db.apolloClientRule.findUniqueOrThrow({ where: { kind_value: { kind: "domain", value: "hotchicatering.net" } } })).clientId).not.toBe(hotchi.id);
    expect(await db.client.count()).toBe(7);
    expect(await db.agent.count()).toBe(15);
    expect(await db.callTimezoneRule.count()).toBe(3);
  });
});
