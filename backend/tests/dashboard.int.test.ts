/**
 * The dashboards' data: overview, tables, profiles, recordings, emails, revenue and call timing, against a real Postgres.
 * Needs TEST_DATABASE_URL (an empty, UTF-8 database); without it these tests are skipped.
 */
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

let db: typeof import("../src/db.js").db;
let dash: typeof import("../src/services/dashboard.js");
let ref: typeof import("../src/services/referenceData.js");
let cache: typeof import("../src/services/cache.js");
let sanitize: typeof import("../src/services/sanitize.js");
let server: Server;
let base = "";
let token = "";

beforeAll(async () => {
  if (!HAS_DB) return;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  ({ db } = await import("../src/db.js"));
  dash = await import("../src/services/dashboard.js");
  ref = await import("../src/services/referenceData.js");
  cache = await import("../src/services/cache.js");
  sanitize = await import("../src/services/sanitize.js");
  // the real router, behind a real session cookie
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { dashboardRouter } = await import("../src/routes/dashboard.js");
  const { SignJWT } = await import("jose");
  token = await new SignJWT({ userId: "u1", email: "viewer@example.com", role: "VIEWER" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  const app = express();
  app.use(cookieParser());
  app.use("/api", dashboardRouter);
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  if (!HAS_DB) return;
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await db.$executeRaw`TRUNCATE calls, emails, sync_runs, job_locks, agents, representatives, clients, apollo_client_map, call_timezone_rules, settings, assignment_uploads, daily_rollups, billing_orders, phone_matches RESTART IDENTITY CASCADE`;
  await ref.ensureReferenceData();
  cache.clearCache();
});

const api = (path: string, auth = true) => fetch(base + path, { headers: auth ? { cookie: `session=${token}` } : {} });
const id = async (kind: "client" | "rep", name: string) => (kind === "client" ? (await db.client.findUniqueOrThrow({ where: { name } })).id : (await db.representative.findUniqueOrThrow({ where: { name } })).id);
const zeros = { calls: 0, meaningful: 0, mqlOver90: 0, dMql: 0, dInterested: 0, dCallback: 0, dNotInterested: 0, dWrongNumber: 0, dMqlFu: 0, dDnc: 0, dNoAnswer: 0, dBadNumber: 0, dVoicemail: 0, dMeeting: 0, dBlank: 0, dOther: 0 };

async function roll(shift: string, client: string, rep: string, o: Partial<typeof zeros>) {
  await db.dailyRollup.create({ data: { shiftDate: new Date(shift), clientId: await id("client", client), representativeId: await id("rep", rep), lineNo10: "9990001111", ...zeros, ...o } });
}
async function order(invoice: string, client: string, rep: string, orderDate: string, total: number) {
  await db.billingOrder.create({ data: { invoiceNo: invoice, clientId: await id("client", client), representativeId: await id("rep", rep), orderDate: new Date(orderDate), total } });
}
async function mail(msgId: string, client: string, o: Record<string, unknown> = {}) {
  await db.email.create({
    data: { id: msgId, clientId: await id("client", client), sent: true, sentAt: new Date("2026-10-13T20:00:00Z"), sentDatePacific: new Date("2026-10-13"), toEmail: "buyer@example.com", toName: "Buyer", toCompany: "Acme", subject: "Hello", raw: {}, ...o } as never,
  });
}

describe.skipIf(!HAS_DB)("overview", () => {
  const seed = async () => {
    await roll("2026-10-13", "Rasa", "David", { calls: 100, meaningful: 6, mqlOver90: 3, dMql: 5, dInterested: 5, dNotInterested: 10, dNoAnswer: 60, dBlank: 20, dBadNumber: 0 });
    await roll("2026-10-14", "HotChi", "Phoebe", { calls: 50, meaningful: 2, mqlOver90: 1, dMql: 1, dCallback: 4, dNoAnswer: 40, dBadNumber: 5 });
    await order("#1", "HotChi", "Phoebe", "2026-10-13", 100);
    await order("#2", "HotChi", "Phoebe", "2026-10-27", 300); // two weeks later: the week between has no orders but still counts
    await order("#3", "Cedar's", "Kylie", "2026-10-14", 200); // a client with orders but no calls
    await mail("m1", "Rasa", { opened: true });
    await mail("m2", "Rasa", { replied: true, opened: true });
    await mail("m3", "Rasa", { bounced: true });
    await mail("m4", "Rasa", { unsubscribed: true });
    await mail("not-sent", "Rasa", { sent: false, sentAt: null, sentDatePacific: null });
  };
  it("totals the three sections for the dates", async () => {
    await seed();
    const o = await dash.overview({ from: "2026-10-01", to: "2026-10-31" });
    expect(o.calls).toMatchObject({ dials: 150, connects: 25, meaningful: 8, mql: 6, mqlOver90: 4, mqlUnder90: 2, answered: 25, notAnswered: 125 });
    expect(o.revenue).toMatchObject({ total: 600, orders: 3, avgOrder: 200, weeks: 3, weeklyRunRate: 200 }); // 600 over 3 weeks, one of them empty
    expect(o.emails).toMatchObject({ sent: 4, delivered: 3, opened: 2, replied: 1, bounced: 1, unsubscribed: 1 }); // the unsent one is not counted
  });
  it("a client is active when it has calls, orders or emails; the table has one row each", async () => {
    await seed();
    const o = await dash.overview({ from: "2026-10-01", to: "2026-10-31" });
    expect(o.activeClients).toEqual({ count: 3, of: 6 }); // Rasa (calls, emails), HotChi (calls, orders), Cedar's (orders only)
    expect(o.byClient.map((c) => c.name)).toEqual(["Rasa", "HotChi", "Cedar's"]);
    expect(o.byClient[1]).toMatchObject({ dials: 50, orders: 2, revenue: 400, emailsSent: 0 });
    expect(o.byClient[2]).toMatchObject({ dials: 0, orders: 1, revenue: 200 });
    expect(o.byClient[0]).toMatchObject({ emailsSent: 4, opened: 2, replied: 1 });
  });
  it("a range with nothing in it is all zeros", async () => {
    await seed();
    const o = await dash.overview({ from: "2026-09-01", to: "2026-09-02" });
    expect(o.activeClients.count).toBe(0);
    expect(o.revenue).toMatchObject({ total: 0, orders: 0, avgOrder: null, weeklyRunRate: null });
    expect(o.byClient).toEqual([]);
  });
  it("emails are filtered by Apollo's Pacific date", async () => {
    await mail("late", "Rasa", { sentAt: new Date("2026-10-14T06:30:00Z"), sentDatePacific: new Date("2026-10-13") }); // 11:30 PM on the 13th, Pacific
    expect((await dash.overview({ from: "2026-10-13", to: "2026-10-13" })).emails.sent).toBe(1);
    expect((await dash.overview({ from: "2026-10-14", to: "2026-10-14" })).emails.sent).toBe(0);
  });
});

describe.skipIf(!HAS_DB)("tables and the previous period", () => {
  const seed = async () => {
    await roll("2026-10-06", "Rasa", "David", { calls: 40, dMql: 2, dNoAnswer: 38, meaningful: 1 }); // the week before
    await roll("2026-10-13", "Rasa", "David", { calls: 100, dMql: 5, dNoAnswer: 95, meaningful: 3 });
    await roll("2026-10-13", "Eight Turn Crepe", "David", { calls: 30, dInterested: 3, dNoAnswer: 27 });
    await roll("2026-10-13", "Rasa", "Nia", { calls: 60, dNoAnswer: 60 });
  };
  it("one row per Representative, opening into their clients, busiest first", async () => {
    await seed();
    const t = await dash.repTable({ from: "2026-10-13", to: "2026-10-19" }, "2026-10-06");
    expect(t.reps.map((r) => [r.name, r.stats.calls])).toEqual([["David", 130], ["Nia", 60]]);
    expect(t.reps[0].children.map((c) => [c.name, c.stats.calls])).toEqual([["Rasa", 100], ["Eight Turn Crepe", 30]]);
    expect(t.total.calls).toBe(190);
  });
  it("compares with the same number of days straight before, and has no comparison before the data starts", async () => {
    await seed();
    const t = await dash.repTable({ from: "2026-10-13", to: "2026-10-19" }, "2026-10-06");
    expect(t.kpis.previousRange).toEqual({ from: "2026-10-06", to: "2026-10-12" });
    expect(t.kpis.current.calls).toBe(190);
    expect(t.kpis.previous).toMatchObject({ calls: 40, meaningful: 1 });
    const first = await dash.repTable({ from: "2026-10-06", to: "2026-10-12" }, "2026-10-06");
    expect(first.kpis.previous).toBeNull(); // the days before would start before the data does
  });
  it("the client table turns it around: a client opening into its Representatives", async () => {
    await seed();
    const t = await dash.clientTable({ from: "2026-10-13", to: "2026-10-19" });
    expect(t.clients.map((c) => [c.name, c.stats.calls])).toEqual([["Rasa", 160], ["Eight Turn Crepe", 30]]);
    expect(t.clients[0].children.map((r) => [r.name, r.stats.calls])).toEqual([["David", 100], ["Nia", 60]]);
  });
  it("Kutlerri's own Representative never shows", async () => {
    await roll("2026-10-13", "Rasa", "Arman Agrawal", { calls: 99 });
    const t = await dash.repTable({ from: "2026-10-13", to: "2026-10-19" }, "2026-10-06");
    expect(t.reps).toEqual([]);
  });
  it("No Answer includes calls with no disposition, and the breakdown adds up", async () => {
    await roll("2026-10-13", "Rasa", "David", { calls: 10, dNoAnswer: 3, dBlank: 4, dBadNumber: 1, dVoicemail: 1, dMeeting: 1 });
    const s = (await dash.repTable({ from: "2026-10-13", to: "2026-10-13" }, "2026-10-13")).reps[0].stats;
    expect(s.dispositions.no_answer).toBe(7);
    expect(s.notAnswered).toBe(8);
    expect(s.answered).toBe(0);
  });
});

describe.skipIf(!HAS_DB)("profiles", () => {
  it("a Representative's profile: chips for their clients, tiles, revenue; a chip with no calls is forgotten", async () => {
    await roll("2026-10-13", "Rasa", "David", { calls: 100, dMql: 4, mqlOver90: 1, meaningful: 2 });
    await roll("2026-10-13", "Eight Turn Crepe", "David", { calls: 30, dMql: 1, mqlOver90: 1, meaningful: 1 });
    await order("#1", "Eight Turn Crepe", "David", "2026-10-13", 250);
    const david = await id("rep", "David"), etc = await id("client", "Eight Turn Crepe"), cedars = await id("client", "Cedar's");
    const all = await dash.repProfile(david, { from: "2026-10-13", to: "2026-10-13" }, []);
    expect(all.options.map((o) => [o.name, o.calls])).toEqual([["Rasa", 100], ["Eight Turn Crepe", 30]]);
    expect(all.stats).toMatchObject({ calls: 130, mql: 5, mqlOver90: 2, mqlUnder90: 3 });
    expect(all.revenue).toEqual({ total: 250, orders: 1 });
    const one = await dash.repProfile(david, { from: "2026-10-13", to: "2026-10-13" }, [etc, cedars]);
    expect(one.selected).toEqual([etc]); // Cedar's has no calls from David in these dates, so it is dropped
    expect(one.stats.calls).toBe(30);
    const rasaOnly = await dash.repProfile(david, { from: "2026-10-13", to: "2026-10-13" }, [await id("client", "Rasa")]);
    expect(rasaOnly.revenue).toBeNull(); // no Rasa orders: no revenue tile
  });
  it("a client's profile filters by Representative", async () => {
    await roll("2026-10-13", "Rasa", "David", { calls: 100 });
    await roll("2026-10-13", "Rasa", "Nia", { calls: 60 });
    const rasa = await id("client", "Rasa"), nia = await id("rep", "Nia");
    const p = await dash.clientProfile(rasa, { from: "2026-10-13", to: "2026-10-13" }, [nia]);
    expect(p.options.map((o) => o.name)).toEqual(["David", "Nia"]);
    expect(p.stats.calls).toBe(60);
  });
});

// ───────────────────────── recordings ─────────────────────────

describe.skipIf(!HAS_DB)("call recordings", () => {
  let n = 0;
  async function call(o: { client: string; rep: string; shift?: string; time?: string; disp?: string | null; dur?: number; url?: string | null; contact?: string }) {
    const [client, rep] = [await id("client", o.client), await id("rep", o.rep)];
    const callId = `r${++n}`;
    const shift = o.shift ?? "2026-10-13";
    await db.call.create({
      data: {
        id: callId, justcallNo10: "9990001111", contactNo10: o.contact ?? `55500000${String(n).padStart(2, "0")}`, durationSec: o.dur ?? 30, localDate: new Date(shift), localTime: "12:00:00", tzUsed: "America/New_York",
        occurredAt: new Date(`${shift}T${o.time ?? "12:00:00"}Z`), shiftDate: new Date(shift), dispositionKey: o.disp === undefined ? null : o.disp, direction: null,
        recordingUrl: o.url === undefined ? `https://rec.example.com/${callId}` : o.url, raw: {},
      },
    });
    await db.callAttribution.create({ data: { callId, status: "CLIENT", clientId: client, representativeId: rep, reason: "sheet" } });
    return callId;
  }
  const q = async (kind: "rep" | "client", idn: number, o: Partial<import("../src/services/dashboard.js").RecordingQuery> = {}) =>
    dash.recordings(kind, idn, { range: { from: "2026-10-01", to: "2026-10-31" }, filterIds: [], q: "", category: null, sub: null, limit: 50, ...o });

  it("lists only calls with a recording link, newest first, with the time in IST", async () => {
    await call({ client: "Rasa", rep: "David", time: "10:00:00" });
    await call({ client: "Rasa", rep: "David", time: "11:00:00" });
    await call({ client: "Rasa", rep: "David", url: null }); // no recording
    const r = await q("rep", await id("rep", "David"));
    expect(r.total).toBe(2);
    expect(r.items.map((i) => i.time)).toEqual(["16:30", "15:30"]); // 11:00 UTC and 10:00 UTC are 16:30 and 15:30 IST
    expect(r.items[0]).toMatchObject({ date: "2026-10-13", client: "Rasa", representative: "David" });
  });
  it("Answered and Not answered, with a count under each; no disposition counts as No Answer", async () => {
    await call({ client: "Rasa", rep: "David", disp: "mql" });
    await call({ client: "Rasa", rep: "David", disp: "interested" });
    await call({ client: "Rasa", rep: "David", disp: "no_answer" });
    await call({ client: "Rasa", rep: "David", disp: null });
    await call({ client: "Rasa", rep: "David", disp: "bad_number" });
    await call({ client: "Rasa", rep: "David", disp: "voicemail" }); // in neither group
    const david = await id("rep", "David");
    const all = await q("rep", david);
    expect(all.counts).toMatchObject({ all: 6, answered: 2, notAnswered: 3 });
    expect(all.counts.sub).toMatchObject({ mql: 1, interested: 1, no_answer: 2, bad_number: 1 });
    const na = await q("rep", david, { category: "not_answered" });
    expect(na.total).toBe(3);
    expect(na.items.map((i) => i.disposition).sort()).toEqual([null, "bad_number", "no_answer"].sort());
    const only = await q("rep", david, { category: "not_answered", sub: "no_answer" });
    expect(only.total).toBe(2); // the one with no disposition is here too
    expect((await q("rep", david, { category: "answered" })).items).toHaveLength(2);
  });
  it("shows who the prospect is: one person, several people, or not in the databases", async () => {
    const rasa = await id("client", "Rasa");
    await call({ client: "Rasa", rep: "David", contact: "5551110001", time: "10:00:00" });
    await call({ client: "Rasa", rep: "David", contact: "5551110002", time: "11:00:00" });
    await call({ client: "Rasa", rep: "David", contact: "5551110003", time: "12:00:00" });
    await db.phoneMatch.create({ data: { clientId: rasa, phoneNo10: "5551110001", kind: "one", name: "Ann Lee", company: "Acme Catering", title: "Owner" } });
    await db.phoneMatch.create({ data: { clientId: rasa, phoneNo10: "5551110002", kind: "multiple", name: "Multiple contacts", company: "Acme Catering", title: "", candidates: "Ann Lee (Owner), Bo Chen (Chef)" } });
    const items = (await q("rep", await id("rep", "David"))).items;
    expect(items[0].prospect).toEqual({ kind: "none" });
    expect(items[1].prospect).toMatchObject({ kind: "multiple", name: "Multiple contacts", candidates: "Ann Lee (Owner), Bo Chen (Chef)" });
    expect(items[2].prospect).toMatchObject({ kind: "one", name: "Ann Lee", company: "Acme Catering", title: "Owner" });
  });
  it("a match only counts for the same client's databases", async () => {
    await call({ client: "Rasa", rep: "David", contact: "5551110001" });
    await db.phoneMatch.create({ data: { clientId: await id("client", "HotChi"), phoneNo10: "5551110001", kind: "one", name: "Someone Else", company: "X", title: "Y" } });
    expect((await q("rep", await id("rep", "David"))).items[0].prospect.kind).toBe("none");
  });
  it("search: every word must match the prospect's name, company or title, the candidates, or the number dialled", async () => {
    const rasa = await id("client", "Rasa");
    await call({ client: "Rasa", rep: "David", contact: "5551110001" });
    await call({ client: "Rasa", rep: "David", contact: "5551110002" });
    await db.phoneMatch.create({ data: { clientId: rasa, phoneNo10: "5551110001", kind: "one", name: "Ann Lee", company: "Acme Catering", title: "Owner" } });
    await db.phoneMatch.create({ data: { clientId: rasa, phoneNo10: "5551110002", kind: "one", name: "Bo Chen", company: "Acme Bakery", title: "Chef" } });
    const david = await id("rep", "David");
    expect((await q("rep", david, { q: "acme" })).total).toBe(2);
    expect((await q("rep", david, { q: "acme catering" })).total).toBe(1);
    expect((await q("rep", david, { q: "ann owner" })).items[0].prospect).toMatchObject({ name: "Ann Lee" });
    expect((await q("rep", david, { q: "(555) 111-0002" })).total).toBe(1); // a phone number, typed any way
    expect((await q("rep", david, { q: "zzz" })).total).toBe(0);
    expect((await q("rep", david, { q: "100%" })).total).toBe(0); // a % in the search is just text
  });
  it("a client's recordings can be narrowed to some Representatives; a Representative's to some clients", async () => {
    await call({ client: "Rasa", rep: "David" });
    await call({ client: "Rasa", rep: "Nia" });
    await call({ client: "Eight Turn Crepe", rep: "David" });
    const rasa = await id("client", "Rasa"), david = await id("rep", "David"), nia = await id("rep", "Nia");
    expect((await q("client", rasa)).total).toBe(2);
    const onlyNia = await q("client", rasa, { filterIds: [nia] });
    expect(onlyNia.items.map((i) => i.representative)).toEqual(["Nia"]);
    expect((await q("rep", david, { filterIds: [rasa] })).total).toBe(1);
  });
  it("limits the rows and says whether there are more; the date range uses the shift day", async () => {
    for (let i = 0; i < 5; i++) await call({ client: "Rasa", rep: "David", time: `1${i}:00:00` });
    await call({ client: "Rasa", rep: "David", shift: "2026-09-20" });
    const david = await id("rep", "David");
    const page = await q("rep", david, { limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(true);
    expect((await q("rep", david, { limit: 5 })).hasMore).toBe(false);
  });
});

// ───────────────────────── emails ─────────────────────────

describe.skipIf(!HAS_DB)("emails", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  it("a client's emails: summary for the dates, buttons counted after the search, newest first", async () => {
    const rasa = await id("client", "Rasa");
    await mail("a", "Rasa", { subject: "Menu for your event", sentAt: new Date("2026-10-13T20:00:00Z"), opened: true, toCompany: "Acme" });
    await mail("b", "Rasa", { subject: "Catering offer", sentAt: new Date("2026-10-14T20:00:00Z"), replied: true, opened: true, toCompany: "Beta" });
    await mail("c", "Rasa", { subject: "Catering follow up", sentAt: new Date("2026-10-15T20:00:00Z"), bounced: true, toCompany: "Gamma" });
    const all = await dash.clientEmails(rasa, { range, q: "", filter: "all", limit: 50 });
    expect(all.summary).toMatchObject({ sent: 3, opened: 2, replied: 1, bounced: 1 });
    expect(all.items.map((e) => e.id)).toEqual(["c", "b", "a"]);
    const search = await dash.clientEmails(rasa, { range, q: "catering", filter: "all", limit: 50 });
    expect(search.summary.sent).toBe(3); // the summary ignores the search
    expect(search.counts).toMatchObject({ all: 2, opened: 1, replied: 1, bounced: 1 });
    const replied = await dash.clientEmails(rasa, { range, q: "", filter: "replied", limit: 50 });
    expect(replied.items.map((e) => e.id)).toEqual(["b"]);
    expect(replied.total).toBe(1);
  });
  it("only emails that were sent count, and only for that client", async () => {
    await mail("a", "Rasa");
    await mail("draft", "Rasa", { sent: false });
    await mail("other", "HotChi");
    const r = await dash.clientEmails(await id("client", "Rasa"), { range, q: "", filter: "all", limit: 50 });
    expect(r.items.map((e) => e.id)).toEqual(["a"]);
  });
  it("a reply is shown only when Apollo marks the email as replied", async () => {
    await mail("plain", "Rasa", { replyText: "a copy of the sent email, which Apollo puts here on many rows", replied: false });
    await mail("answered", "Rasa", { replyText: "Thanks, let's talk Tuesday.", replied: true });
    expect((await dash.emailDetail("plain"))?.replyText).toBeNull();
    expect((await dash.emailDetail("answered"))?.replyText).toBe("Thanks, let's talk Tuesday.");
    expect(await dash.emailDetail("missing")).toBeNull();
  });
  it("an email body is cleaned of anything that can run before it is shown", async () => {
    await mail("evil", "Rasa", { bodyHtml: `<p onclick="x()">Hi <b>there</b></p><script>alert(1)</script><img src="x" onerror="y()"><a href="javascript:alert(2)">click</a><a href="https://ok.example.com">ok</a><iframe src="https://evil.example.com"></iframe><style>body{display:none}</style>` });
    const html = (await dash.emailDetail("evil"))!.bodyHtml!;
    expect(html).toContain("<b>there</b>");
    expect(html).toContain('href="https://ok.example.com"');
    for (const bad of ["<script", "onclick", "onerror", "javascript:", "<iframe", "<style"]) expect(html.toLowerCase()).not.toContain(bad);
    expect(sanitize.sanitizeEmailHtml(null)).toBeNull();
  });
});

// ───────────────────────── revenue ─────────────────────────

describe.skipIf(!HAS_DB)("revenue by week", () => {
  it("by Representative with the clients behind each figure, and by client with the Representatives", async () => {
    await order("#1", "HotChi", "Phoebe", "2026-10-13", 100);
    await order("#2", "Cedar's", "Phoebe", "2026-10-14", 50);
    await order("#3", "HotChi", "Steven", "2026-10-15", 25);
    const r = { from: "2026-10-01", to: "2026-10-31" };
    const byRep = await dash.revenueWeekly("rep", r);
    expect(byRep.summary).toMatchObject({ revenue: 175, orders: 3, runRate: 175 });
    const phoebe = byRep.rows.find((x) => x.name === "Phoebe")!;
    expect(phoebe.cells["2026-10-12"].by.map((b) => [b.name, b.orders, b.revenue])).toEqual([["HotChi", 1, 100], ["Cedar's", 1, 50]]);
    const byClient = await dash.revenueWeekly("client", r);
    const hotchi = byClient.rows.find((x) => x.name === "HotChi")!;
    expect(hotchi.cells["2026-10-12"].by.map((b) => [b.name, b.revenue])).toEqual([["Phoebe", 100], ["Steven", 25]]);
    expect(byClient.totals[0].revenue).toBe(175);
    expect(byClient.weeks[0]).toMatchObject({ monday: "2026-10-12", isoWeek: 42 });
  });
});

// ───────────────────────── call timing ─────────────────────────

describe.skipIf(!HAS_DB)("call timing and breaks", () => {
  let n = 0;
  /** A call at an IST clock time (hh:mm on the shift day, or the morning after when hh >= 24), 60 seconds long. */
  async function at(rep: string, client: string, shift: string, hh: number, mm: number, secs = 60) {
    const callId = `t${++n}`;
    const istMinutes = hh * 60 + mm; // from midnight of the shift date, IST
    const occurred = new Date(Date.parse(`${shift}T00:00:00Z`) + istMinutes * 60_000 - 330 * 60_000); // IST is UTC+5:30
    await db.call.create({
      data: { id: callId, justcallNo10: "9990001111", durationSec: secs, localDate: new Date(shift), localTime: "00:00:00", tzUsed: "America/New_York", occurredAt: occurred, shiftDate: new Date(shift), raw: {} },
    });
    await db.callAttribution.create({ data: { callId, status: "CLIENT", clientId: await id("client", client), representativeId: await id("rep", rep), reason: "sheet" } });
  }
  async function stretch(rep: string, client: string, shift: string, from: [number, number], to: [number, number]) {
    for (let m = from[0] * 60 + from[1]; m < to[0] * 60 + to[1]; m += 2) await at(rep, client, shift, Math.floor(m / 60), m % 60);
  }

  it("finds a Representative's break against the schedule, in IST", async () => {
    await stretch("David", "Gyro Republic", "2026-10-13", [19, 40], [22, 30]); // starts 10 minutes late
    await stretch("David", "Gyro Republic", "2026-10-13", [23, 50], [24, 30]); // back 20 minutes late
    const d = await dash.timingDay("2026-10-13");
    expect(d.reps).toHaveLength(1);
    const r = d.reps[0];
    expect(r.name).toBe("David");
    expect(r.first).toBe(19 * 60 + 40);
    expect(r.main!.len).toBeCloseTo(81, 0);
    expect(r.schedule).toEqual({ start: 19 * 60 + 30, breakStart: 22 * 60 + 30, breakEnd: 23 * 60 + 30 });
    expect(r.breakOver).toBe(true);
    expect(r.lateReturn).toBe(true);
    expect(r.lateStart).toBe(false); // 10 minutes is within the grace
    expect(d.summary).toMatchObject({ dialing: 1, breaks: 1, breakOver: 1, backLate: 1 });
  });
  it("Rasa has its own schedule, set by the client the Representative called most that day", async () => {
    await stretch("Nia", "Rasa", "2026-10-13", [18, 30], [21, 30]);
    await stretch("Nia", "Rasa", "2026-10-13", [22, 30], [24, 0]);
    const r = (await dash.timingDay("2026-10-13")).reps[0];
    expect(r.schedule).toEqual({ start: 18 * 60 + 30, breakStart: 21 * 60 + 30, breakEnd: 22 * 60 + 30 });
    expect(r.lateStart).toBe(false);
    expect(r.breakOver).toBe(false);
    expect(r.clients[0].name).toBe("Rasa");
  });
  it("a call after midnight belongs to the shift that started the evening before", async () => {
    await stretch("David", "Gyro Republic", "2026-10-13", [19, 30], [22, 30]);
    await at("David", "Gyro Republic", "2026-10-13", 25, 30); // 1:30 AM on the 14th, still the 13th's shift
    const d = await dash.timingDay("2026-10-13");
    expect(d.reps[0].last).toBe(25 * 60 + 30);
    expect((await dash.timingDay("2026-10-14")).reps).toEqual([]);
  });
  it("the pickers list the days and weeks that have calls, and who dialed", async () => {
    await at("David", "Rasa", "2026-10-13", 20, 0);
    await at("Nia", "Rasa", "2026-10-14", 20, 0);
    await at("David", "Rasa", "2026-10-21", 20, 0);
    const p = await dash.timingDays({ from: "2026-10-01", to: "2026-10-31" });
    expect(p.days).toEqual(["2026-10-13", "2026-10-14", "2026-10-21"]);
    expect(p.weeks.map((w) => w.monday)).toEqual(["2026-10-12", "2026-10-19"]);
    expect(p.weeks[0].representatives.map((r) => [r.name, r.dials])).toEqual([["David", 1], ["Nia", 1]]);
  });
  it("the weekly view is one Representative's seven days", async () => {
    await stretch("David", "Gyro Republic", "2026-10-13", [19, 30], [24, 0]);
    await stretch("David", "Gyro Republic", "2026-10-15", [19, 30], [24, 0]);
    await stretch("Nia", "Rasa", "2026-10-14", [19, 30], [24, 0]);
    const w = await dash.timingWeek("2026-10-12", await id("rep", "David"));
    expect(w.days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(w.days.map((d) => !!d.day)).toEqual([false, true, false, true, false, false, false]); // Nia's day is not David's
    expect(w.summary).toMatchObject({ daysDialed: 2 });
  });
});

// ───────────────────────── the web routes ─────────────────────────

describe.skipIf(!HAS_DB)("the dashboard routes", () => {
  it("need a signed-in user", async () => {
    expect((await api("/overview?from=2026-10-01&to=2026-10-31", false)).status).toBe(401);
    expect((await api("/meta", false)).status).toBe(401);
  });
  it("refuse a bad range, a bad id and a bad filter with a message", async () => {
    expect((await api("/overview?from=2026-10-31&to=2026-10-01")).status).toBe(400);
    expect((await api("/overview?from=nope&to=2026-10-01")).status).toBe(400);
    expect((await api("/overview")).status).toBe(400);
    expect((await api("/reps/abc/profile?from=2026-10-01&to=2026-10-31")).status).toBe(400);
    expect((await api("/revenue/weekly?by=nobody&from=2026-10-01&to=2026-10-31")).status).toBe(400);
    expect((await api("/clients/1/emails?from=2026-10-01&to=2026-10-31&filter=bogus")).status).toBe(400);
    expect((await api("/reps/1/recordings?from=2026-10-01&to=2026-10-31&limit=100000")).status).toBe(400);
  });
  it("never show anything before the start date, whatever range is asked for", async () => {
    await roll("2026-08-10", "Rasa", "David", { calls: 77 }); // before 2026-08-17: must not appear
    await roll("2026-08-17", "Rasa", "David", { calls: 5 });
    const res = await api("/overview?from=2026-01-01&to=2026-12-31");
    const o = await res.json();
    expect(o.range.from).toBe("2026-08-17");
    expect(o.calls.dials).toBe(5);
    // a range wholly before the start date is empty, not moved forward onto the first day of data
    const before = await (await api("/overview?from=2026-01-01&to=2026-01-02")).json();
    expect(before.calls.dials).toBe(0);
    expect(before.activeClients.count).toBe(0);
  });
  it("answers the same question from the cache, and forgets it when data changes", async () => {
    await roll("2026-10-13", "Rasa", "David", { calls: 5 });
    const url = "/overview?from=2026-10-01&to=2026-10-31";
    expect((await (await api(url)).json()).calls.dials).toBe(5);
    await roll("2026-10-14", "Rasa", "David", { calls: 7 });
    expect((await (await api(url)).json()).calls.dials).toBe(5); // still the cached answer
    cache.clearCache(); // what a sync, an upload or a rollback does
    expect((await (await api(url)).json()).calls.dials).toBe(12);
  });
  it("a missing email is a clean 404", async () => {
    expect((await api("/emails/does-not-exist")).status).toBe(404);
  });
});
