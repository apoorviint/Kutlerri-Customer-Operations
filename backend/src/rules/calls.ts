/** Business rules for calls. Pure functions only, so every rule can be tested exactly. */

export const DISPOSITION_KEYS = [
  "mql", "interested", "callback", "not_interested", "wrong_number", "mql_fu", "dnc",
  "no_answer", "bad_number", "voicemail", "meeting",
] as const;
export type DispositionKey = (typeof DISPOSITION_KEYS)[number];

export const DISPOSITION_LABELS: Record<DispositionKey, string> = {
  mql: "MQL",
  interested: "Interested / FUP Needed",
  callback: "Call Back Later",
  not_interested: "Not Interested",
  wrong_number: "Wrong Number",
  mql_fu: "MQL Follow-Up",
  dnc: "Do Not Call Again",
  no_answer: "No Answer",
  bad_number: "Bad Number",
  voicemail: "Left Voicemail",
  meeting: "Meeting Set",
};

/** A call that reached a person. These are also the "Answered" calls. */
export const CONNECT_KEYS: readonly DispositionKey[] = ["mql", "interested", "callback", "not_interested", "wrong_number", "mql_fu", "dnc"];
/** Calls nobody picked up. A call with no disposition counts here as No Answer. voicemail and meeting are in neither group. */
export const NOT_ANSWERED_KEYS: readonly DispositionKey[] = ["no_answer", "bad_number"];

export const MEANINGFUL_SECONDS = 90; // a connect must last strictly longer than this

// How JustCall writes each disposition (after the "Dispositions:" prefix and case are removed).
const DISPOSITION_TEXT: Record<string, DispositionKey> = {
  "mql": "mql",
  "interested but follow up needed": "interested",
  "interested / fup needed": "interested",
  "interested": "interested",
  "call back later": "callback",
  "not interested": "not_interested",
  "wrong number": "wrong_number",
  "mql follow-up": "mql_fu",
  "mql follow up": "mql_fu",
  "do not call again": "dnc",
  "no answer": "no_answer",
  "bad number": "bad_number",
  "left voicemail": "voicemail",
  "meeting set": "meeting",
};

const normalizeText = (s: string) => s.trim().replace(/^dispositions?\s*:\s*/i, "").trim().replace(/\s+/g, " ").toLowerCase();

/** Maps JustCall's text to one of the 11 keys. Empty means "no disposition"; unknown text is reported, not guessed. */
export function mapDisposition(raw: string | null | undefined): { key: DispositionKey | null; unknown: boolean } {
  if (raw == null || raw.trim() === "") return { key: null, unknown: false };
  const key = DISPOSITION_TEXT[normalizeText(raw)];
  return key ? { key, unknown: false } : { key: null, unknown: true };
}

export type Direction = "outbound" | "inbound";

const OUTBOUND = new Set(["outbound", "outgoing", "out", "outbound call", "outgoing call"]);
const INBOUND = new Set(["inbound", "incoming", "in", "inbound call", "incoming call", "missed", "missed call", "voicemail"]);

/**
 * Only calls made from our side (outbound) count. The call-logs API does not send a direction today, so this returns
 * null for "not said"; once the API sends one, anything that is clearly inbound is kept out of the dashboards.
 * An unfamiliar word is reported as unknown (null), not guessed.
 */
export function mapDirection(raw: unknown): { direction: Direction | null; unknown: boolean } {
  if (raw == null || String(raw).trim() === "") return { direction: null, unknown: false };
  const t = String(raw).trim().toLowerCase().replace(/[_-]+/g, " ");
  if (OUTBOUND.has(t)) return { direction: "outbound", unknown: false };
  if (INBOUND.has(t)) return { direction: "inbound", unknown: false };
  return { direction: null, unknown: true };
}

const connectSet = new Set<string>(CONNECT_KEYS);
export const isConnect = (key: string | null) => key !== null && connectSet.has(key);
export const isMeaningful = (key: string | null, durationSec: number) => isConnect(key) && durationSec > MEANINGFUL_SECONDS;
/** MQL means disposition `mql` only (not `mql_fu`). */
export const isMqlOver90 = (key: string | null, durationSec: number) => key === "mql" && durationSec > MEANINGFUL_SECONDS;

/** Phone numbers are compared by their last 10 digits. */
export function last10(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
}

/** JustCall writes agent names with inconsistent casing ("krissh singh"), so agents are matched on this key. */
export const agentKey = (name: string | null | undefined) => (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
