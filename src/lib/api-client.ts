import { z } from "zod";

/**
 * Internal API client for calls and mails. Endpoint paths and field names are PLACEHOLDERS:
 * adjust CALLS_PATH / MAILS_PATH and mapCall() / mapMail() once the real API is known.
 */
const CALLS_PATH = "/calls";
const MAILS_PATH = "/mails";

const Item = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
type Raw = z.infer<typeof Item> & Record<string, unknown>;

const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (typeof v === "number" ? Math.round(v) : v == null ? null : Math.round(Number(v)) || null);
const date = (v: unknown) => {
  if (v == null) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

export function mapCall(r: Raw) {
  return {
    externalId: String(r.id),
    direction: str(r.direction),
    agent: str(r.agent),
    customer: str(r.customer),
    status: str(r.status),
    durationSec: num(r.duration),
    startedAt: date(r.started_at ?? r.date),
    payload: r,
  };
}

export function mapMail(r: Raw) {
  return {
    externalId: String(r.id),
    subject: str(r.subject),
    fromAddr: str(r.from),
    toAddr: str(r.to),
    status: str(r.status),
    sentAt: date(r.sent_at ?? r.date),
    payload: r,
  };
}

function headers(): HeadersInit {
  const token = process.env.API_TOKEN;
  const h: Record<string, string> = { Accept: "application/json" };
  if (token) {
    const name = process.env.API_AUTH_HEADER || "Authorization";
    h[name] = name.toLowerCase() === "authorization" ? `Bearer ${token}` : token;
  }
  return h;
}

async function fetchList(path: string): Promise<Raw[]> {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error("API_BASE_URL is not set");
  const res = await fetch(new URL(path, base), { headers: headers(), cache: "no-store" });
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : (json.data ?? json.items ?? []);
  return z.array(Item).parse(list) as Raw[];
}

export const fetchCalls = async () => (await fetchList(CALLS_PATH)).map(mapCall);
export const fetchMails = async () => (await fetchList(MAILS_PATH)).map(mapMail);
