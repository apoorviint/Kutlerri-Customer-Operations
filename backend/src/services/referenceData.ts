import { db } from "../db.js";
import { agentKey } from "../rules/calls.js";
import type { EmailRule } from "../rules/emails.js";
import type { TzRule } from "../rules/time.js";
import { SETTING_DEFAULTS } from "./settings.js";

/**
 * Starting data. It is only ever added when missing, so anything an admin later edits is never overwritten.
 */
const CLIENTS = [
  { name: "Rasa", kind: "CUSTOMER" },
  { name: "Cedar's", kind: "CUSTOMER" },
  { name: "Eight Turn Crepe", kind: "CUSTOMER" },
  { name: "Gyro Republic", kind: "CUSTOMER" },
  { name: "HotChi", kind: "CUSTOMER" },
  { name: "Kati Roll", kind: "CUSTOMER" },
  { name: "Kutlerri", kind: "INTERNAL" },
] as const;

const REPRESENTATIVES = [
  "Kylie", "David", "Kevin", "Phoebe", "Steven", "Hiya", "Andrew", "Dave", "Rohit",
  "Akil Choudhury", "Nia", "Pranav", "Robin", "Abby Wilson",
] as const;
const INTERNAL_REPRESENTATIVES = ["Arman Agrawal"] as const;

// agent (the real person in JustCall) -> Representative (the working name shown in the dashboards)
const AGENT_TO_REP: Record<string, string> = {
  "Khusbu Raj": "Kylie",
  "Debrup Ghosh": "David",
  "Krissh Singh": "Kevin",
  "Purbasha Sarkar": "Phoebe",
  "Rishabh Srivastav": "Steven",
  "Hiya Dutta": "Hiya",
  "Andrew Robert": "Andrew",
  "Dave Som": "Dave",
  "Rohit Swain": "Rohit",
  "Akil Choudhury": "Akil Choudhury",
  "Nia A": "Nia",
  "Pranav Kumar": "Pranav",
  "Robin Dale": "Robin",
  "Abby Wilson": "Abby Wilson",
  "Arman Agrawal": "Arman Agrawal",
};

// Each client sends from its own domain (checked against all 7,469 emails in the reference file: no domain is shared).
const EMAIL_DOMAINS: Record<string, string[]> = {
  "Rasa": ["rasacatering.co", "rasa.co"],
  "Cedar's": ["eatcedarscatering.com"],
  "Eight Turn Crepe": ["eightturncrepecatering.com"],
  "Gyro Republic": ["gyrorepublic-catering.com"],
  "HotChi": ["hotchicatering.net"],
  "Kati Roll": ["thekatirollcompanycatering.com"],
  "Kutlerri": ["kutlerricorp.com"],
};

// The call-logs API gives call times with no time zone. Comparing it with the workbook behind the prototype showed
// these agents' clocks run an hour differently from the default (US Eastern). Confirm in JustCall and edit if wrong.
const TZ_RULES = [
  { agentKey: "abby wilson", zone: "America/Chicago", validFrom: "2026-09-28", note: "Line Abby_Houston: times are US Central from 28 Sep 2026" },
  { agentKey: "robin dale", zone: "America/Chicago", validFrom: "2026-09-28", note: "Line Robin_Chicago: times are US Central from 28 Sep 2026" },
  { agentKey: "andrew robert", zone: "UTC-3", validFrom: "2026-09-08", note: "Lines Andrew_NYC, Andrew_Dallas and his own line: times run at UTC-3 from 8 Sep 2026. Check around 1 Nov (clock change)." },
] as const;

export async function ensureReferenceData() {
  for (const [i, c] of CLIENTS.entries()) {
    await db.client.upsert({ where: { name: c.name }, create: { name: c.name, kind: c.kind, sortOrder: i }, update: {} });
  }
  for (const name of REPRESENTATIVES) await db.representative.upsert({ where: { name }, create: { name }, update: {} });
  for (const name of INTERNAL_REPRESENTATIVES) {
    await db.representative.upsert({ where: { name }, create: { name, internal: true }, update: {} });
  }
  const reps = new Map((await db.representative.findMany()).map((r) => [r.name, r.id]));
  for (const [agent, rep] of Object.entries(AGENT_TO_REP)) {
    const representativeId = reps.get(rep);
    if (!representativeId) throw new Error(`Seed error: unknown representative ${rep}`);
    // an agent that already exists keeps whatever mapping it has now
    await db.agent.upsert({ where: { key: agentKey(agent) }, create: { key: agentKey(agent), name: agent, representativeId }, update: {} });
  }
  const clients = new Map((await db.client.findMany()).map((c) => [c.name, c.id]));
  for (const [client, domains] of Object.entries(EMAIL_DOMAINS)) {
    for (const value of domains) {
      await db.apolloClientRule.upsert({
        where: { kind_value: { kind: "domain", value } },
        create: { kind: "domain", value, clientId: clients.get(client)! },
        update: {},
      });
    }
  }
  for (const r of TZ_RULES) {
    const exists = await db.callTimezoneRule.findFirst({ where: { agentKey: r.agentKey, validFrom: new Date(r.validFrom) } });
    if (!exists) await db.callTimezoneRule.create({ data: { agentKey: r.agentKey, zone: r.zone, validFrom: new Date(r.validFrom), note: r.note } });
  }
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}

export async function loadEmailRules(): Promise<EmailRule[]> {
  return (await db.apolloClientRule.findMany()).map((r) => ({ kind: r.kind as EmailRule["kind"], value: r.value, clientId: r.clientId }));
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export async function loadTzRules(): Promise<TzRule[]> {
  return (await db.callTimezoneRule.findMany()).map((r) => ({
    agentKey: r.agentKey, lineNo10: r.lineNo10, zone: r.zone, validFrom: day(r.validFrom), validTo: r.validTo ? day(r.validTo) : null,
  }));
}
