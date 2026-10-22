import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { requireAdmin } from "../auth.js";
import { agentKey, last10 } from "../rules/calls.js";
import { toUtc } from "../rules/time.js";
import { audit } from "../services/audit.js";
import { clearCache } from "../services/cache.js";
import { dataQuality } from "../services/dataQuality.js";
import { runJob } from "../services/jobs.js";
import { loadSettings } from "../services/settings.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const who = (req: { session?: { email: string } }) => req.session!.email;
const bad = (res: import("express").Response, error: string) => void res.status(400).json({ error });
const id = (v: string) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

// ───────────── data quality and audit log ─────────────

adminRouter.get("/data-quality", async (_req, res) => res.json(await dataQuality()));

adminRouter.get("/audit", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(await db.auditLog.findMany({ orderBy: { at: "desc" }, take: limit }));
});

// ───────────── templates ─────────────

const csv = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
const TEMPLATES: Record<string, { file: string; body: string }> = {
  assignments: {
    file: "who-dialed-for-whom-template.csv",
    body: csv([
      ["Date", "Representative", "Client", "Phone number"],
      ["2026-10-19", "Nia", "Rasa", "(571) 500-2756"],
      ["2026-10-19", "Nia", "Rasa", "(571) 500-2757"],
    ]),
  },
  "assignments-weekly": {
    file: "who-dialed-for-whom-weekly-template.csv",
    body: csv([
      ["Week of", "Representative", "Client", "Phone number"],
      ["2026-10-19", "Nia", "Rasa", "(571) 500-2756"],
    ]),
  },
  billing: {
    file: "billing-template.csv",
    body: csv([
      ["Invoice no", "Client", "Representative", "Created date", "Order date", "Account", "Subtotal", "Tax", "Tip", "Fee", "Discount", "Total"],
      ["INV-1001", "Rasa", "Nia", "2026-10-10", "2026-10-18", "Acme Corp", "500.00", "40.00", "50.00", "10.00", "0.00", "600.00"],
    ]),
  },
  prospects: {
    file: "prospect-database-template.csv",
    body: csv([
      ["First Name", "Last Name", "Title", "Company", "Mobile Phone", "Work Direct Phone", "HQ Phone"],
      ["Jane", "Doe", "Office Manager", "Acme Corp", "(555) 123-4567", "(555) 123-0000", "(555) 999-0000"],
    ]),
  },
};

adminRouter.get("/templates/:name", (req, res) => {
  const t = TEMPLATES[req.params.name];
  if (!t) return void res.status(404).json({ error: "No such template" });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${t.file}"`);
  res.send("﻿" + t.body);
});

// ───────────── mappings ─────────────

adminRouter.get("/mappings", async (_req, res) => {
  const [representatives, clients, agents, apolloRules, tzRules, settings] = await Promise.all([
    db.representative.findMany({ orderBy: { name: "asc" } }),
    db.client.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.agent.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { calls: true } } } }),
    db.apolloClientRule.findMany({ orderBy: [{ kind: "asc" }, { value: "asc" }] }),
    db.callTimezoneRule.findMany({ orderBy: { validFrom: "desc" } }),
    loadSettings(),
  ]);
  res.json({
    representatives, clients,
    agents: agents.map((a) => ({ id: a.id, name: a.name, representativeId: a.representativeId, calls: a._count.calls })),
    apolloRules, tzRules: tzRules.map((r) => ({ ...r, validFrom: r.validFrom.toISOString().slice(0, 10), validTo: r.validTo?.toISOString().slice(0, 10) ?? null })),
    settings,
  });
});

const names = (n: string) => n.trim().replace(/\s+/g, " ");

adminRouter.post("/representatives", async (req, res) => {
  const p = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!p.success) return bad(res, "Give the Representative a name.");
  const name = names(p.data.name);
  if (await db.representative.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad(res, "There is already a Representative with that name.");
  const r = await db.representative.create({ data: { name } });
  await audit(who(req), "representative.add", name);
  res.status(201).json(r);
});

adminRouter.post("/clients", async (req, res) => {
  const p = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body);
  if (!p.success) return bad(res, "Give the client a name.");
  const name = names(p.data.name);
  if (await db.client.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad(res, "There is already a client with that name.");
  const max = await db.client.aggregate({ _max: { sortOrder: true } });
  const c = await db.client.create({ data: { name, kind: "CUSTOMER", sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await audit(who(req), "client.add", name);
  clearCache();
  res.status(201).json(c);
});

/** Which Representative an agent (the real person logged in to JustCall) works as. Calls are re-attributed afterwards. */
adminRouter.put("/agents/:id", async (req, res) => {
  const agentId = id(req.params.id);
  const p = z.object({ representativeId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!agentId || !p.success) return bad(res, "Send { representativeId } (or null to unmap).");
  const agent = await db.agent.findUnique({ where: { id: agentId } });
  if (!agent) return void res.status(404).json({ error: "No such agent" });
  if (p.data.representativeId && !(await db.representative.findUnique({ where: { id: p.data.representativeId } }))) return bad(res, "No such Representative.");
  await db.agent.update({ where: { id: agentId }, data: { representativeId: p.data.representativeId } });
  await audit(who(req), "agent.map", agent.name, { from: agent.representativeId, to: p.data.representativeId });
  void runJob("attribute-calls", { triggeredBy: `mapping:${who(req)}` });
  res.json({ ok: true, recalculating: true });
});

const Rule = z.object({ kind: z.enum(["domain", "mailbox", "sequence"]), value: z.string().min(1).max(200), clientId: z.number().int().positive() });
adminRouter.post("/apollo-rules", async (req, res) => {
  const p = Rule.safeParse(req.body);
  if (!p.success) return bad(res, "Send { kind: domain | mailbox | sequence, value, clientId }.");
  const value = p.data.value.trim().toLowerCase().replace(/^@/, "");
  if (p.data.kind === "domain" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return bad(res, "That does not look like a domain (example: rasacatering.co).");
  if (p.data.kind === "mailbox" && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value)) return bad(res, "That does not look like an email address.");
  if (!(await db.client.findUnique({ where: { id: p.data.clientId } }))) return bad(res, "No such client.");
  if (await db.apolloClientRule.findUnique({ where: { kind_value: { kind: p.data.kind, value } } })) return bad(res, "That rule already exists. Delete it first to point it to another client.");
  const r = await db.apolloClientRule.create({ data: { kind: p.data.kind, value, clientId: p.data.clientId } });
  await audit(who(req), "apollo-rule.add", `${p.data.kind}: ${value}`, { clientId: p.data.clientId });
  void runJob("recompute-email-clients", { triggeredBy: `mapping:${who(req)}` });
  res.status(201).json(r);
});

adminRouter.delete("/apollo-rules/:id", async (req, res) => {
  const ruleId = id(req.params.id);
  const r = ruleId ? await db.apolloClientRule.findUnique({ where: { id: ruleId } }) : null;
  if (!r) return void res.status(404).json({ error: "No such rule" });
  await db.apolloClientRule.delete({ where: { id: r.id } });
  await audit(who(req), "apollo-rule.delete", `${r.kind}: ${r.value}`);
  void runJob("recompute-email-clients", { triggeredBy: `mapping:${who(req)}` });
  res.json({ ok: true });
});

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Tz = z.object({
  agentName: z.string().max(100).optional(), lineNo10: z.string().optional(), zone: z.string().min(2).max(40),
  validFrom: Day, validTo: Day.nullable().optional(), note: z.string().max(200).optional(),
});
adminRouter.post("/tz-rules", async (req, res) => {
  const p = Tz.safeParse(req.body);
  if (!p.success) return bad(res, "Send { agentName and/or lineNo10, zone, validFrom }.");
  const line = p.data.lineNo10 ? last10(p.data.lineNo10) : null;
  if (!p.data.agentName?.trim() && !line) return bad(res, "Name an agent, a phone line, or both.");
  try { toUtc("2026-01-01", "12:00:00", p.data.zone); } catch { return bad(res, 'Unknown time zone. Use a name like "America/Chicago" or an offset like "UTC-3".'); }
  const rule = await db.callTimezoneRule.create({
    data: { agentKey: p.data.agentName?.trim() ? agentKey(p.data.agentName) : null, lineNo10: line, zone: p.data.zone, validFrom: new Date(p.data.validFrom), validTo: p.data.validTo ? new Date(p.data.validTo) : null, note: p.data.note ?? null },
  });
  await audit(who(req), "tz-rule.add", p.data.agentName ?? line, { zone: p.data.zone, from: p.data.validFrom, to: p.data.validTo ?? null });
  void runJob("recompute-call-times", { from: p.data.validFrom, triggeredBy: `mapping:${who(req)}` });
  res.status(201).json(rule);
});

adminRouter.delete("/tz-rules/:id", async (req, res) => {
  const ruleId = id(req.params.id);
  const r = ruleId ? await db.callTimezoneRule.findUnique({ where: { id: ruleId } }) : null;
  if (!r) return void res.status(404).json({ error: "No such rule" });
  await db.callTimezoneRule.delete({ where: { id: r.id } });
  await audit(who(req), "tz-rule.delete", r.agentKey ?? r.lineNo10, { zone: r.zone });
  void runJob("recompute-call-times", { from: r.validFrom.toISOString().slice(0, 10), triggeredBy: `mapping:${who(req)}` });
  res.json({ ok: true });
});

// ───────────── settings ─────────────

const Hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use 24-hour HH:MM");
const Schedule = z.object({ start: Hm, breakStart: Hm, breakEnd: Hm });
const SettingsPatch = z.object({
  backfillStart: Day.optional(),
  agentFallback: z.boolean().optional(),
  agentFallbackExcludedLines: z.array(z.string().regex(/^\d{10}$/, "ten digits")).max(100).optional(),
  prospectShow: z.record(z.array(z.enum(["name", "phone"]))).optional(),
  timing: z.object({
    gapMinutes: z.number().int().min(1).max(120), breakMinMinutes: z.number().int().min(1).max(240), windowMinutes: z.number().int().min(1).max(600),
    graceMinutes: z.number().int().min(0).max(120), allowedBreakMinutes: z.number().int().min(1).max(240),
    default: Schedule, clients: z.record(Schedule),
  }).optional(),
}).strict();

adminRouter.put("/settings", async (req, res) => {
  const p = SettingsPatch.safeParse(req.body);
  if (!p.success) return bad(res, p.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; "));
  const before = await loadSettings();
  const changed: string[] = [];
  for (const [key, value] of Object.entries(p.data)) {
    if (value === undefined || JSON.stringify(before[key as keyof typeof before]) === JSON.stringify(value)) continue;
    await db.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
    changed.push(key);
    await audit(who(req), "settings.update", key, { from: before[key as keyof typeof before], to: value });
  }
  clearCache();
  // these decide who calls belong to, so recalculate
  if (changed.includes("agentFallback") || changed.includes("agentFallbackExcludedLines")) void runJob("attribute-calls", { triggeredBy: `settings:${who(req)}` });
  res.json({ changed, settings: await loadSettings() });
});
