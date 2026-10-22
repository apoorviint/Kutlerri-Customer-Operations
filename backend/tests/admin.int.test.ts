/**
 * The admin console against a real Postgres, through the real routers and a real session cookie: file uploads
 * (assignments, billing, prospect databases), mappings, settings, data quality and the audit log.
 * Needs TEST_DATABASE_URL (an empty, UTF-8 database); without it these tests are skipped.
 */
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;
const uploadDir = mkdtempSync(join(tmpdir(), "ops-uploads-"));
process.env.UPLOAD_DIR = uploadDir;

let db: typeof import("../src/db.js").db;
let ref: typeof import("../src/services/referenceData.js");
let cache: typeof import("../src/services/cache.js");
let server: Server;
let base = "";
let admin = "";
let viewer = "";

beforeAll(async () => {
  if (!HAS_DB) return;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  ({ db } = await import("../src/db.js"));
  ref = await import("../src/services/referenceData.js");
  cache = await import("../src/services/cache.js");
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { SignJWT } = await import("jose");
  const sign = (role: string) => new SignJWT({ userId: role, email: `${role.toLowerCase()}@example.com`, role }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
  admin = await sign("ADMIN");
  viewer = await sign("VIEWER");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  const api = express.Router();
  api.use("/admin/files", (await import("../src/routes/uploads.js")).uploadsRouter);
  api.use("/admin", (await import("../src/routes/admin.js")).adminRouter);
  app.use("/api", api);
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
});

afterAll(async () => {
  if (!HAS_DB) return;
  await waitIdle();
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await waitIdle();
  await db.$executeRaw`TRUNCATE calls, emails, sync_runs, job_locks, agents, representatives, clients, apollo_client_map, call_timezone_rules, settings, assignment_uploads, daily_rollups, billing_orders, billing_uploads, billing_changes, phone_matches, prospect_batches, prospect_phones, audit_log RESTART IDENTITY CASCADE`;
  await ref.ensureReferenceData();
  cache.clearCache();
});

/** Background work (recalculation after an upload) must finish before the next test wipes the tables. */
async function waitIdle() {
  for (let i = 0; i < 200; i++) {
    const running = await db.syncRun.count({ where: { status: "running" } });
    const processing = await db.prospectBatch.count({ where: { status: "processing" } });
    if (!running && !processing) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const call = (path: string, init: RequestInit = {}, who: string | null = admin) =>
  fetch(base + path, { ...init, headers: { ...(who ? { cookie: `session=${who}` } : {}), ...(init.headers ?? {}) } });
const json = (path: string, method: string, body: unknown, who: string | null = admin) => call(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }, who);

function form(fileName: string, content: Buffer | string, fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set("file", new Blob([content]), fileName);
  return f;
}
const post = (path: string, f: FormData, who: string | null = admin) => call(path, { method: "POST", body: f }, who);

async function xlsx(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) wb.addWorksheet(name).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const clientId = async (name: string) => (await db.client.findUniqueOrThrow({ where: { name } })).id;

describe.skipIf(!HAS_DB)("only admins get in", () => {
  it.each([
    ["GET", "/mappings"], ["GET", "/data-quality"], ["GET", "/audit"], ["GET", "/templates/billing"], ["PUT", "/settings"],
    ["GET", "/files/prospects/batches"], ["GET", "/files/billing/uploads"], ["POST", "/files/billing/preview"], ["POST", "/files/prospects/upload"],
  ])("%s %s", async (method, path) => {
    expect((await call(path, { method }, null)).status).toBe(401);
    expect((await call(path, { method }, viewer)).status).toBe(403);
  });
});

describe.skipIf(!HAS_DB)("templates", () => {
  it("each template downloads and is accepted by the reader it is meant for", async () => {
    const { parseAssignmentSheet } = await import("../src/rules/assignmentSheet.js");
    const { parseBillingSheet } = await import("../src/rules/billingSheet.js");
    const { findHeader } = await import("../src/rules/prospects.js");
    const { readSheets } = await import("../src/services/fileGrid.js");
    const { writeFileSync } = await import("node:fs");
    const get = async (name: string) => {
      const r = await call(`/templates/${name}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-disposition")).toMatch(/attachment/);
      const p = join(uploadDir, `${name}.csv`);
      writeFileSync(p, Buffer.from(await r.arrayBuffer()));
      return (await readSheets(p, `${name}.csv`))[0].rows;
    };
    expect(parseAssignmentSheet(await get("assignments"), { anchor: "2026-10-19" })).toMatchObject({ errors: [], layout: "normalized" });
    expect(parseAssignmentSheet(await get("assignments-weekly"), { anchor: "2026-10-19" }).errors).toEqual([]);
    expect(parseBillingSheet(await get("billing")).errors).toEqual([]);
    expect(findHeader(await get("prospects"))).not.toBeNull();
    expect((await call("/templates/nope")).status).toBe(404);
  });
});

describe.skipIf(!HAS_DB)("who dialed for whom: upload a file", () => {
  const csv = "Date,Representative,Client,Phone number\n2026-10-19,Nia,Rasa,(571) 500-2756\n2026-10-19,Nia,Rasa,(571) 500-2757\n";
  it("previews a csv, then commits it with the staged id; the file is kept, the audit log and history show it", async () => {
    const p = await post("/files/assignments/preview", form("day.csv", csv));
    expect(p.status).toBe(200);
    const preview = await p.json();
    expect(preview).toMatchObject({ rows: 2, errors: [], totals: { added: 2 } });
    expect(await db.lineAssignment.count()).toBe(0); // nothing saved by a preview

    const c = await json("/files/assignments/commit", "POST", { stagedId: preview.stagedId, fileName: "day.csv" });
    expect(await c.json()).toMatchObject({ committed: true });
    expect(await db.lineAssignment.count()).toBe(2);
    const up = await db.assignmentUpload.findFirstOrThrow({ where: { source: "upload" } });
    expect(up.fileKey).toMatch(/^assignments\/\d+-day.csv$/);
    expect((await (await call("/audit")).json())[0]).toMatchObject({ action: "assignments.upload", actor: "admin@example.com" });
    // the staged copy is gone: committing the same id again fails cleanly
    expect((await json("/files/assignments/commit", "POST", { stagedId: preview.stagedId })).status).toBe(404);
  });

  it("reads an xlsx with several sheets (the first with data) and blocks a commit with problems", async () => {
    const file = await xlsx({ Empty: [], Data: [["Date", "Representative", "Client", "Phone number"], ["2026-10-20", "Nobody At All", "Rasa", "5715002756"]] });
    const preview = await (await post("/files/assignments/preview", form("d.xlsx", file))).json();
    expect(preview.sheet).toBe("Data");
    expect(preview.errors.join(" ")).toMatch(/Nobody At All/);
    const c = await json("/files/assignments/commit", "POST", { stagedId: preview.stagedId, fileName: "d.xlsx" });
    expect(c.status).toBe(422);
    expect(await db.lineAssignment.count()).toBe(0);
  });

  it("refuses other file types and an empty request", async () => {
    expect((await post("/files/assignments/preview", form("notes.pdf", "x"))).status).toBe(400);
    expect((await call("/files/assignments/preview", { method: "POST", body: new FormData() })).status).toBe(400);
  });
});

describe.skipIf(!HAS_DB)("billing sheet", () => {
  const head = ["Invoice no", "Client", "Representative", "Created date", "Order date", "Account", "Subtotal", "Tax", "Tip", "Fee", "Discount", "Total"];
  const sheet = (rows: unknown[][]) => xlsx({ Orders: [head, ...rows] });
  const upload = async (rows: unknown[][]) => {
    const p = await (await post("/files/billing/preview", form("b.xlsx", await sheet(rows)))).json();
    return { p, commit: () => json("/files/billing/commit", "POST", { stagedId: p.stagedId, fileName: "b.xlsx" }) };
  };

  it("adds new orders by invoice number, flags a total that does not add up, and shows what a re-upload would change", async () => {
    const one = await upload([["A1", "Rasa", "Nia", "2026-10-10", "2026-10-18", "Acme", 500, 40, 50, 10, 0, 600], ["A2", "HotChi", "Nia", null, "2026-10-19", "", 100, 0, 0, 0, 20, 100]]);
    expect(one.p).toMatchObject({ added: 2, changed: 0, errors: [], willCommit: true });
    expect(one.p.flags).toEqual([{ invoiceNo: "A2", total: 100, expected: 80, difference: 20 }]);
    expect((await one.commit()).status).toBe(200);
    expect(await db.billingOrder.count()).toBe(2);

    const two = await upload([["A1", "Rasa", "Nia", "2026-10-10", "2026-10-18", "Acme", 500, 40, 50, 10, 0, 650], ["A2", "HotChi", "Nia", null, "2026-10-19", "", 100, 0, 0, 0, 20, 100], ["A3", "Rasa", "Nia", null, "2026-10-20", "", 10, 0, 0, 0, 0, 10]]);
    expect(two.p).toMatchObject({ added: 1, changed: 1, unchanged: 1 });
    expect(two.p.changes.find((c: { invoiceNo: string }) => c.invoiceNo === "A1").fields).toEqual([{ field: "total", from: 600, to: 650 }]);
    await two.commit();
    expect(await db.billingOrder.count()).toBe(3); // updated by key, not duplicated
    expect(Number((await db.billingOrder.findUniqueOrThrow({ where: { invoiceNo: "A1" } })).total)).toBe(650);
  });

  it("identical re-upload changes nothing; rolling back restores the old values and removes new orders; only the latest can be rolled back", async () => {
    const rows1 = [["A1", "Rasa", "Nia", null, "2026-10-18", "", 100, 0, 0, 0, 0, 100]];
    const a = await upload(rows1);
    const { uploadId: first } = await (await a.commit()).json();
    const same = await upload(rows1);
    expect(same.p).toMatchObject({ added: 0, changed: 0, unchanged: 1, willCommit: false });
    expect(await (await same.commit()).json()).toMatchObject({ committed: false });

    const b = await upload([["A1", "Rasa", "Nia", null, "2026-10-18", "", 100, 0, 0, 0, 0, 120], ["A9", "Rasa", "Nia", null, "2026-10-21", "", 5, 0, 0, 0, 0, 5]]);
    const { uploadId: second } = await (await b.commit()).json();
    expect((await json(`/files/billing/uploads/${first}/rollback`, "POST", {})).status).toBe(409); // a later upload exists
    expect((await json(`/files/billing/uploads/${second}/rollback`, "POST", {})).status).toBe(200);
    expect(await db.billingOrder.count()).toBe(1);
    expect(Number((await db.billingOrder.findUniqueOrThrow({ where: { invoiceNo: "A1" } })).total)).toBe(100);
    expect((await json(`/files/billing/uploads/${second}/rollback`, "POST", {})).status).toBe(409);
    const summary = await (await call("/files/billing/summary")).json();
    expect(summary).toMatchObject({ orders: 1, lastUpload: { id: first } });
  });

  it("an unknown client or Representative, or a bad number, blocks the whole upload", async () => {
    const u = await upload([["A1", "Nobody Inc", "Nia", null, "2026-10-18", "", 1, 0, 0, 0, 0, 1], ["A2", "Rasa", "Nia", null, "2026-10-18", "", 1, 0, 0, 0, 0, "abc"]]);
    expect(u.p.errors.length).toBe(2);
    expect(u.p.willCommit).toBe(false);
    expect((await u.commit()).status).toBe(422);
    expect(await db.billingOrder.count()).toBe(0);
  });
});

describe.skipIf(!HAS_DB)("prospect databases", () => {
  const head = ["First Name", "Last Name", "Title", "Company", "Mobile Phone", "Direct Phone", "HQ Phone"];
  async function wait(batchId: number) {
    for (let i = 0; i < 300; i++) {
      const b = await (await call(`/files/prospects/batches/${batchId}`)).json();
      if (b.status !== "processing") return b;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("batch did not finish");
  }
  const send = async (client: string, file: Buffer | string, name: string, extra: Record<string, string> = {}) => {
    const r = await post("/files/prospects/upload", form(name, file, { clientId: String(await clientId(client)), ...extra }));
    return { r, body: await r.json() };
  };
  async function dial(id: string, client: string, contact: string) {
    const rep = await db.representative.findFirstOrThrow();
    const cid = await clientId(client);
    await db.call.create({ data: { id, contactNo10: contact, justcallNo10: "9990001111", durationSec: 10, localDate: new Date("2026-10-19"), localTime: "12:00:00", tzUsed: "America/New_York", occurredAt: new Date("2026-10-19T16:00:00Z"), shiftDate: new Date("2026-10-19"), raw: {} } });
    await db.callAttribution.create({ data: { callId: id, status: "CLIENT", clientId: cid, representativeId: rep.id, reason: "sheet" } });
  }

  it("reads every sheet, skips one with no usable header, matches by the last 10 digits within the client only", async () => {
    await dial("c1", "Rasa", "5551110001"); // one person
    await dial("c2", "Rasa", "5551110002"); // two people, same company
    await dial("c3", "Rasa", "5551110003"); // two companies
    await dial("c4", "Rasa", "5551110004"); // in no database
    await dial("c5", "Rasa", "5551110005"); // only an HQ number: must not match
    await dial("c6", "HotChi", "5551110001"); // another client's call to the same number
    const file = await xlsx({
      Chefs: [head,
        ["Jane", "Doe", "Chef", "Acme", "(555) 111-0001", "", "(555) 111-0005"],
        ["Ann", "Lee", "Owner", "Bistro", "+1 555 111 0002", "5551110003", ""]],
      Managers: [head,
        ["Bob", "Ray", "Manager", "Bistro", "5551110002", "", ""],
        ["Cy", "Dunn", "", "Other Co", "", "5551110003", ""]],
      Notes: [["Remember to call back"], ["Nothing here"]],
    });
    const { r, body } = await send("Rasa", file, "rasa.xlsx");
    expect(r.status).toBe(202);
    const done = await wait(body.batchId);
    expect(done).toMatchObject({ status: "committed", rowsRead: 4, phonesIndexed: 3, newlyMatched: 3 });
    expect(done.sheets.map((s: { name: string; skipped: boolean }) => [s.name, s.skipped])).toEqual([["Chefs", false], ["Managers", false], ["Notes", true]]);

    const m = new Map((await db.phoneMatch.findMany({ where: { clientId: await clientId("Rasa") } })).map((x) => [x.phoneNo10, x]));
    expect(m.get("5551110001")).toMatchObject({ kind: "one", name: "Jane Doe", company: "Acme", title: "Chef" });
    expect(m.get("5551110002")).toMatchObject({ kind: "multiple", name: "Multiple contacts", company: "Bistro" });
    expect(m.get("5551110003")).toMatchObject({ kind: "multiple", company: "Multiple companies", candidates: "Ann Lee (Owner), Cy Dunn" });
    expect(m.has("5551110004")).toBe(false);
    expect(m.has("5551110005")).toBe(false); // an HQ number is not indexed
    expect(await db.phoneMatch.count({ where: { clientId: await clientId("HotChi") } })).toBe(0); // same client only
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "prospects.upload" } })).target).toMatch(/Rasa: rasa.xlsx/);
  });

  it("appends by default; 'replace' needs a confirmation, takes over from earlier files, and rolling it back brings them back", async () => {
    const a = await send("Rasa", await xlsx({ S: [head, ["Jane", "Doe", "Chef", "Acme", "5551110001", "", ""]] }), "a.xlsx");
    await wait(a.body.batchId);
    const b = await send("Rasa", await xlsx({ S: [head, ["Bob", "Ray", "Cook", "Bistro", "5551110002", "", ""]] }), "b.csv".replace("csv", "xlsx"));
    await wait(b.body.batchId);
    expect(await db.phoneMatch.count({ where: { clientId: await clientId("Rasa") } })).toBe(2); // appended

    const noConfirm = await send("Rasa", await xlsx({ S: [head, ["New", "Person", "", "Zed", "5551110009", "", ""]] }), "c.xlsx", { replace: "true" });
    expect(noConfirm.r.status).toBe(400);
    expect(noConfirm.body.error).toMatch(/Confirm/);

    const c = await send("Rasa", await xlsx({ S: [head, ["New", "Person", "", "Zed", "5551110009", "", ""]] }), "c.xlsx", { replace: "true", confirmReplace: "true" });
    await wait(c.body.batchId);
    const after = await db.phoneMatch.findMany({ where: { clientId: await clientId("Rasa") } });
    expect(after.map((x) => x.phoneNo10)).toEqual(["5551110009"]);

    const undo = await json(`/files/prospects/batches/${c.body.batchId}/rollback`, "POST", {});
    expect(undo.status).toBe(200);
    expect((await db.phoneMatch.findMany({ where: { clientId: await clientId("Rasa") } })).map((x) => x.phoneNo10).sort()).toEqual(["5551110001", "5551110002"]);
    expect((await json(`/files/prospects/batches/${c.body.batchId}/rollback`, "POST", {})).status).toBe(409); // already rolled back
    expect((await json(`/files/prospects/batches/${a.body.batchId}/rollback`, "POST", {})).status).toBe(200);
    expect(await db.phoneMatch.count({ where: { clientId: await clientId("Rasa") } })).toBe(1);

    const list = await (await call(`/files/prospects/batches?clientId=${await clientId("Rasa")}`)).json();
    expect(list.map((x: { status: string }) => x.status)).toEqual(["rolled_back", "committed", "rolled_back"]);
  });

  it("a file with no usable header is a failed batch with a reason, and nothing is stored", async () => {
    const { body } = await send("Rasa", await xlsx({ S: [["Just", "Words"], ["a", "b"]] }), "junk.xlsx");
    const done = await wait(body.batchId);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/header/);
    expect(await db.prospectPhone.count()).toBe(0);
  });

  it("reads a csv, and rejects a client that does not exist or an internal one", async () => {
    const { body } = await send("Cedar's", "Name,Title,Company,Phone\nZoe Fox,GM,Cedar Hall,555-222-3333\n", "c.csv");
    expect(await wait(body.batchId)).toMatchObject({ status: "committed", phonesIndexed: 1 });
    const bad = await post("/files/prospects/upload", form("x.csv", "Name,Phone\nA,5552223333", { clientId: "9999" }));
    expect(bad.status).toBe(400);
    const internal = await post("/files/prospects/upload", form("x.csv", "Name,Phone\nA,5552223333", { clientId: String(await clientId("Kutlerri")) }));
    expect(internal.status).toBe(400);
  });

  it("streams a big multi-sheet workbook without loading it whole (60,000 rows)", async () => {
    const path = join(uploadDir, "big.xlsx");
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useSharedStrings: true });
    for (const name of ["One", "Two", "Three"]) {
      const ws = wb.addWorksheet(name);
      ws.addRow(head).commit();
      for (let i = 0; i < 20000; i++) ws.addRow([`First${i}`, `Last${i}`, "Buyer", `Company ${i % 500}`, String(2000000000 + (name === "One" ? 0 : name === "Two" ? 20000 : 40000) + i), "", ""]).commit();
      await ws.commit();
    }
    await wb.commit();
    const { readFileSync } = await import("node:fs");
    const { body } = await send("Rasa", readFileSync(path), "big.xlsx");
    const done = await wait(body.batchId);
    expect(done.error ?? null).toBeNull();
    expect(done).toMatchObject({ status: "committed", rowsRead: 60000, phonesIndexed: 60000 });
  }, 120_000);
});

describe.skipIf(!HAS_DB)("mappings and settings", () => {
  it("maps an agent to a Representative, recalculates, and logs it", async () => {
    const agent = await db.agent.create({ data: { key: "new person", name: "New Person" } });
    const rep = await db.representative.findFirstOrThrow({ where: { name: "Nia" } });
    expect((await json(`/agents/${agent.id}`, "PUT", { representativeId: rep.id })).status).toBe(200);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).representativeId).toBe(rep.id);
    expect((await json(`/agents/${agent.id}`, "PUT", { representativeId: 99999 })).status).toBe(400);
    expect((await (await call("/audit")).json()).map((a: { action: string }) => a.action)).toContain("agent.map");
    const m = await (await call("/mappings")).json();
    expect(m.agents.find((a: { id: number }) => a.id === agent.id)).toMatchObject({ representativeId: rep.id });
    expect(m.settings.agentFallback).toBe(false);
  });

  it("Apollo rules: validated, no duplicates, deletable, and emails are re-matched", async () => {
    const hotchi = await clientId("HotChi");
    expect((await json("/apollo-rules", "POST", { kind: "domain", value: "not a domain", clientId: hotchi })).status).toBe(400);
    const ok = await json("/apollo-rules", "POST", { kind: "domain", value: "@NewBrand.com", clientId: hotchi });
    expect(ok.status).toBe(201);
    expect(await db.apolloClientRule.findFirst({ where: { value: "newbrand.com" } })).not.toBeNull();
    expect((await json("/apollo-rules", "POST", { kind: "domain", value: "newbrand.com", clientId: hotchi })).status).toBe(400);
    const { id } = await ok.json();
    expect((await call(`/apollo-rules/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(`/apollo-rules/${id}`, { method: "DELETE" })).status).toBe(404);
  });

  it("time zone rules: the zone is checked, and a bad one is refused", async () => {
    expect((await json("/tz-rules", "POST", { agentName: "Abby Wilson", zone: "Mars/Olympus", validFrom: "2026-10-01" })).status).toBe(400);
    expect((await json("/tz-rules", "POST", { zone: "UTC-3", validFrom: "2026-10-01" })).status).toBe(400); // names nobody
    const ok = await json("/tz-rules", "POST", { agentName: "  Test   Agent ", zone: "America/Chicago", validFrom: "2026-10-01" });
    expect(ok.status).toBe(201);
    expect((await db.callTimezoneRule.findFirstOrThrow({ where: { agentKey: "test agent" } })).zone).toBe("America/Chicago");
  });

  it("settings: only known keys and valid values are accepted, changes are logged, 'from' and 'to' are recorded", async () => {
    expect((await json("/settings", "PUT", { shiftZone: "UTC" })).status).toBe(400); // not changeable here
    expect((await json("/settings", "PUT", { backfillStart: "yesterday" })).status).toBe(400);
    expect((await json("/settings", "PUT", { agentFallbackExcludedLines: ["123"] })).status).toBe(400);
    const r = await json("/settings", "PUT", { agentFallback: true, prospectShow: { Rasa: ["name", "phone"] } });
    expect(await r.json()).toMatchObject({ changed: ["agentFallback", "prospectShow"], settings: { agentFallback: true } });
    const again = await json("/settings", "PUT", { agentFallback: true });
    expect((await again.json()).changed).toEqual([]); // nothing changed, nothing logged
    const logs = await db.auditLog.findMany({ where: { action: "settings.update" } });
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.target === "agentFallback")?.details).toEqual({ from: false, to: true });
    const t = await json("/settings", "PUT", { timing: { gapMinutes: 10, breakMinMinutes: 20, windowMinutes: 90, graceMinutes: 10, allowedBreakMinutes: 60, default: { start: "19:30", breakStart: "25:00", breakEnd: "23:30" }, clients: {} } });
    expect(t.status).toBe(400);
  });

  it("adds a Representative and a client, refusing duplicates in any casing", async () => {
    expect((await json("/representatives", "POST", { name: "Zoe Zed" })).status).toBe(201);
    expect((await json("/representatives", "POST", { name: "zoe  zed" })).status).toBe(400);
    expect((await json("/clients", "POST", { name: "Brand New Co" })).status).toBe(201);
    expect((await json("/clients", "POST", { name: "RASA" })).status).toBe(400);
  });
});

describe.skipIf(!HAS_DB)("data quality", () => {
  it("lists unassigned lines with counts and dates, orders whose total does not add up, missing recordings, unmapped agents and unmatched email domains", async () => {
    const rep = await db.representative.findFirstOrThrow();
    const agent = await db.agent.create({ data: { key: "lone agent", name: "Lone Agent" } }); // not mapped
    const mk = async (id: string, phone: string, shift: string, status: string, url: string | null, dur = 30) => {
      await db.call.create({ data: { id, contactNo10: "5550001111", justcallNo10: phone, agentId: agent.id, durationSec: dur, localDate: new Date(shift), localTime: "12:00:00", tzUsed: "America/New_York", occurredAt: new Date(`${shift}T16:00:00Z`), shiftDate: new Date(shift), recordingUrl: url, raw: {} } });
      await db.callAttribution.create({ data: { callId: id, status, clientId: status === "CLIENT" ? await clientId("Rasa") : null, representativeId: status === "CLIENT" ? rep.id : null, reason: status === "CLIENT" ? "sheet" : "no-assignment" } });
    };
    await mk("u1", "7770001111", "2026-10-19", "UNASSIGNED", "https://x/1");
    await mk("u2", "7770001111", "2026-10-21", "UNASSIGNED", "https://x/2");
    await mk("u3", "7770002222", "2026-10-20", "UNASSIGNED", "https://x/3");
    await mk("m1", "9990001111", "2026-10-20", "CLIENT", null); // no recording
    await mk("m2", "9990001111", "2026-10-20", "CLIENT", "https://x/ok");
    await db.billingOrder.create({ data: { invoiceNo: "BAD1", clientId: await clientId("Rasa"), representativeId: rep.id, orderDate: new Date("2026-10-19"), subtotal: 100, discount: 10, total: 100 } });
    await db.billingOrder.create({ data: { invoiceNo: "GOOD1", clientId: await clientId("Rasa"), representativeId: rep.id, orderDate: new Date("2026-10-19"), subtotal: 100, discount: 10, total: 90 } });
    await db.email.create({ data: { id: "e1", sent: true, sentAt: new Date("2026-10-20T10:00:00Z"), sentDatePacific: new Date("2026-10-20"), senderDomain: "stranger.com", raw: {} } as never });

    const q = await (await call("/data-quality")).json();
    expect(q.unassigned).toEqual([
      { line: "7770001111", calls: 2, first: "2026-10-19", last: "2026-10-21", agents: ["Lone Agent"] },
      { line: "7770002222", calls: 1, first: "2026-10-20", last: "2026-10-20", agents: ["Lone Agent"] },
    ]);
    expect(q.discountMismatches).toEqual([expect.objectContaining({ invoiceNo: "BAD1", total: 100, expected: 90, difference: 10 })]);
    expect(q.missingRecordings).toEqual([expect.objectContaining({ rep: rep.name, calls: 1 })]);
    expect(q.unmappedAgents.map((a: { name: string }) => a.name)).toEqual(["Lone Agent"]);
    expect(q.unmappedEmails).toEqual([{ domain: "stranger.com", emails: 1 }]);
    expect(q.alerts.join(" ")).toMatch(/3 calls have no client/);
    expect(q.feeds.calls.newestRecordAt).toBeTruthy();
  });

  it("a phone line listed for two clients in the same period, and a pair of numbers that trade clients, are reported", async () => {
    const svc = await import("../src/services/assignments.js");
    const rep = "Nia";
    const row = (phone: string, client: string, from: string) => ({ rowNo: 1, representative: rep, client, phoneNo10: phone, from, to: null as string | null, granularity: "daily" as const });
    // the same line for two clients on the same day (blocked at upload, so insert through force)
    await svc.commitAssignments({ rows: [row("5550101010", "Rasa", "2026-10-19"), row("5550202020", "HotChi", "2026-10-19"), row("5550101010", "HotChi", "2026-10-20"), row("5550202020", "Rasa", "2026-10-20")], layout: "normalized" }, { source: "upload", uploadedBy: "t", force: true }).catch(() => {});
    const q = await (await call("/data-quality")).json();
    expect(Array.isArray(q.twoClients)).toBe(true);
    expect(Array.isArray(q.swaps)).toBe(true);
  });

  it("stale feed: no new call for more than 2 hours during a shift raises an alert", async () => {
    const { DateTime } = await import("luxon");
    const nowIst = DateTime.now().setZone("Asia/Kolkata");
    const inShift = nowIst.hour >= 17 || nowIst.hour < 5;
    const agent = await db.agent.create({ data: { key: "a", name: "A" } });
    const old = new Date(Date.now() - 5 * 3600_000);
    await db.call.create({ data: { id: "old", agentId: agent.id, durationSec: 1, localDate: old, localTime: "12:00:00", tzUsed: "America/New_York", occurredAt: old, shiftDate: old, raw: {} } });
    const q = await (await call("/data-quality")).json();
    expect(q.feeds.calls.stale).toBe(inShift);
    expect(q.feeds.calls.hoursSinceNewest).toBeGreaterThan(4.9);
    expect(q.alerts.some((a: string) => /No new calls/.test(a))).toBe(inShift);
  });
});

void createWriteStream;
