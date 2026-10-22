import { z } from "zod";
import { config } from "../config.js";

const PER_PAGE = 500; // the API's maximum

const nullableStr = z.string().nullish().transform((v) => v ?? null);

const CallItem = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  contact_no: nullableStr,
  justcall_no: nullableStr,
  justcall_no_name: nullableStr,
  agent_name: nullableStr,
  recording_url: nullableStr,
  duration: z.number().nullish().transform((v) => Math.max(0, Math.round(v ?? 0))),
  date: z.string(), // YYYY-MM-DD
  time: z.string().nullish(), // HH:MM:SS
  disposition_code: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? null : String(v))),
  synced_at: z.string().nullish(),
});

const EmailItem = z.object({
  apollo_message_id: z.string(),
  sequence: nullableStr,
  sequence_id: nullableStr,
  step: z.number().nullish().transform((v) => v ?? null),
  template: nullableStr,
  from_email: nullableStr,
  to_email: nullableStr,
  from_name: nullableStr,
  to_name: nullableStr,
  subject: nullableStr,
  sent_at: z.string().nullish(),
  scheduled_at: z.string().nullish(),
  sent: z.boolean().nullish().transform(Boolean),
  bounce: z.boolean().nullish().transform(Boolean),
  open: z.boolean().nullish().transform(Boolean),
  click: z.boolean().nullish().transform(Boolean),
  unsubscribe: z.boolean().nullish().transform(Boolean),
  replied: z.boolean().nullish().transform(Boolean),
  contact_id: nullableStr,
  account_id: nullableStr,
  to_company: nullableStr,
  contact_stage: nullableStr,
  synced_at: z.string().nullish(),
});

const Page = z.object({ items: z.array(z.unknown()), total: z.number(), page: z.number() });

const toDate = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export type CallRow = ReturnType<typeof mapCall>;
export type EmailRow = ReturnType<typeof mapEmail>;

export function mapCall(raw: unknown) {
  const r = CallItem.parse(raw);
  return {
    id: r.id,
    contactNo: r.contact_no,
    justcallNo: r.justcall_no,
    justcallNoName: r.justcall_no_name,
    agentName: r.agent_name,
    recordingUrl: r.recording_url,
    duration: r.duration,
    startedAt: new Date(`${r.date}T${r.time || "00:00:00"}Z`),
    disposition: r.disposition_code,
    syncedAt: toDate(r.synced_at) ?? new Date(),
  };
}

export function mapEmail(raw: unknown) {
  const r = EmailItem.parse(raw);
  return {
    id: r.apollo_message_id,
    sequence: r.sequence,
    sequenceId: r.sequence_id,
    step: r.step,
    template: r.template,
    fromEmail: r.from_email,
    toEmail: r.to_email,
    fromName: r.from_name,
    toName: r.to_name,
    subject: r.subject,
    sentAt: toDate(r.sent_at),
    scheduledAt: toDate(r.scheduled_at),
    sent: r.sent,
    bounce: r.bounce,
    open: r.open,
    click: r.click,
    unsubscribe: r.unsubscribe,
    replied: r.replied,
    contactId: r.contact_id,
    accountId: r.account_id,
    toCompany: r.to_company,
    contactStage: r.contact_stage,
    syncedAt: toDate(r.synced_at) ?? new Date(),
  };
}

async function getPage(path: string, params: Record<string, string>) {
  const url = new URL(config.callLogsApi.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.callLogsApi.token) headers.Authorization = `Bearer ${config.callLogsApi.token}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${path} responded ${res.status}`);
      return Page.parse(await res.json());
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Walks every page of a list endpoint (newest first), handing each page to `onPage`.
 * `dateFrom` (YYYY-MM-DD) limits the walk to recent records for incremental syncs.
 * Ids of every row the API returned (whether or not it mapped) are added to `seen`.
 */
async function walk<T>(
  path: string, idKey: string, dateFrom: string | null, perPage: number, seen: Set<string>,
  map: (raw: unknown) => T, onPage: (rows: T[]) => Promise<void>,
) {
  let page = 1;
  let fetched = 0;
  for (;;) {
    const params: Record<string, string> = { page: String(page), per_page: String(perPage) };
    if (dateFrom) params.date_from = dateFrom;
    const res = await getPage(path, params);
    const rows: T[] = [];
    for (const raw of res.items) {
      const id = (raw as Record<string, unknown>)?.[idKey];
      if (id != null) seen.add(String(id));
      try {
        rows.push(map(raw));
      } catch {
        // skip rows that don't match the expected shape rather than failing the whole sync
      }
    }
    await onPage(rows);
    fetched += res.items.length;
    if (res.items.length === 0 || fetched >= res.total) return res.total;
    page++;
  }
}

/**
 * The API pages by offset over a sort with ties (date + time), so a row sitting on a page boundary can be
 * returned twice while another is skipped. If the distinct ids fall short of the API's total, walk again
 * with a different page size (moving the boundaries) until nothing is missing.
 */
const PAGE_SIZES = [500, 499, 497, 491];

async function walkComplete<T>(
  path: string, idKey: string, dateFrom: string | null, map: (raw: unknown) => T, onPage: (rows: T[]) => Promise<void>,
) {
  const seen = new Set<string>();
  let total = 0;
  for (const size of PAGE_SIZES) {
    total = await walk(path, idKey, dateFrom, size, seen, map, onPage);
    if (seen.size >= total) break;
  }
  return { count: seen.size, total };
}

export const walkCalls = (dateFrom: string | null, onPage: (rows: CallRow[]) => Promise<void>) =>
  walkComplete("/v1/calls", "id", dateFrom, mapCall, onPage);
export const walkEmails = (dateFrom: string | null, onPage: (rows: EmailRow[]) => Promise<void>) =>
  walkComplete("/v1/emails", "apollo_message_id", dateFrom, mapEmail, onPage);
