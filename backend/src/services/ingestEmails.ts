import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db.js";
import { mailbox, resolveEmailClient, senderDomain, type EmailRule } from "../rules/emails.js";
import { dateInZone } from "../rules/time.js";
import { fetchWindow } from "./callLogsApi.js";
import type { WindowResult } from "./ingestCalls.js";
import type { Settings } from "./settings.js";

const str = z.string().nullish().transform((v) => (v == null || v === "" ? null : v));
const flag = z.boolean().nullish().transform(Boolean);

const EmailItem = z.object({
  apollo_message_id: z.string().min(1),
  sequence: str,
  sequence_id: str,
  step: z.number().nullish().transform((v) => v ?? null),
  template: str,
  from_email: str,
  to_email: str,
  to_name: str,
  to_company: str,
  subject: str,
  sent_at: z.string().nullish(),
  scheduled_at: z.string().nullish(),
  sent: flag,
  bounce: flag,
  open: flag,
  click: flag,
  unsubscribe: flag,
  replied: flag,
  contact_stage: str,
  synced_at: z.string().nullish(),
});

export type EmailContext = { settings: Settings; rules: EmailRule[] };

const toDate = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

export type EmailRow = ReturnType<typeof mapEmail>;

export function mapEmail(raw: unknown, ctx: EmailContext) {
  const r = EmailItem.parse(raw);
  const sentAt = toDate(r.sent_at);
  return {
    id: r.apollo_message_id,
    mailbox: mailbox(r.from_email),
    senderDomain: senderDomain(r.from_email),
    clientId: resolveEmailClient(ctx.rules, { from: r.from_email, sequence: r.sequence }),
    sequence: r.sequence,
    sequenceId: r.sequence_id,
    step: r.step,
    template: r.template,
    toEmail: r.to_email,
    toName: r.to_name,
    toCompany: r.to_company,
    subject: r.subject,
    sentAt,
    sentDatePacific: sentAt ? dateInZone(sentAt, ctx.settings.emailZone) : null,
    scheduledAt: toDate(r.scheduled_at),
    // only an email with a sent time was actually sent
    sent: r.sent && sentAt !== null,
    bounced: r.bounce,
    opened: r.open,
    clicked: r.click,
    unsubscribed: r.unsubscribe,
    replied: r.replied,
    contactStage: r.contact_stage,
    providerSyncedAt: toDate(r.synced_at),
    raw,
  };
}

/**
 * Not stored yet: the email body and the reply text. The call-logs API sends no bodies, and a body must be
 * cleaned of scripts before it is kept. Both columns exist and stay empty until a source and a cleaner are in place.
 */
export async function upsertEmails(rows: EmailRow[]) {
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (!unique.length) return { inserted: 0, updated: 0, unchanged: 0 };
  const values = unique.map((r) => Prisma.sql`(
    ${r.id}, ${r.mailbox}, ${r.senderDomain}, ${r.clientId}, ${r.sequence}, ${r.sequenceId}, ${r.step}, ${r.template},
    ${r.toEmail}, ${r.toName}, ${r.toCompany}, ${r.subject}, ${r.sentAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC', ${r.sentDatePacific}::date, ${r.scheduledAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC',
    ${r.sent}, ${r.bounced}, ${r.opened}, ${r.clicked}, ${r.unsubscribed}, ${r.replied}, ${r.contactStage},
    ${r.providerSyncedAt?.toISOString() ?? null}::timestamptz AT TIME ZONE 'UTC', timezone('UTC', now()), timezone('UTC', now()), ${JSON.stringify(r.raw)}::jsonb)`);
  const result = await db.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO emails (id, mailbox, sender_domain, client_id, sequence, sequence_id, step, template, to_email, to_name, to_company,
                        subject, sent_at, sent_date_pacific, scheduled_at, sent, bounced, opened, clicked, unsubscribed, replied,
                        contact_stage, provider_synced_at, ingested_at, updated_at, raw)
    VALUES ${Prisma.join(values)}
    ON CONFLICT (id) DO UPDATE SET
      mailbox = EXCLUDED.mailbox, sender_domain = EXCLUDED.sender_domain, client_id = EXCLUDED.client_id, sequence = EXCLUDED.sequence,
      sequence_id = EXCLUDED.sequence_id, step = EXCLUDED.step, template = EXCLUDED.template, to_email = EXCLUDED.to_email,
      to_name = EXCLUDED.to_name, to_company = EXCLUDED.to_company, subject = EXCLUDED.subject, sent_at = EXCLUDED.sent_at,
      sent_date_pacific = EXCLUDED.sent_date_pacific, scheduled_at = EXCLUDED.scheduled_at, sent = EXCLUDED.sent,
      bounced = EXCLUDED.bounced, opened = EXCLUDED.opened, clicked = EXCLUDED.clicked, unsubscribed = EXCLUDED.unsubscribed,
      replied = EXCLUDED.replied, contact_stage = EXCLUDED.contact_stage, provider_synced_at = EXCLUDED.provider_synced_at,
      raw = EXCLUDED.raw, updated_at = timezone('UTC', now())
    WHERE (emails.mailbox, emails.sender_domain, emails.client_id, emails.sequence, emails.sequence_id, emails.step, emails.template,
           emails.to_email, emails.to_name, emails.to_company, emails.subject, emails.sent_at, emails.sent_date_pacific,
           emails.scheduled_at, emails.sent, emails.bounced, emails.opened, emails.clicked, emails.unsubscribed, emails.replied,
           emails.contact_stage, emails.provider_synced_at, emails.raw)
      IS DISTINCT FROM
          (EXCLUDED.mailbox, EXCLUDED.sender_domain, EXCLUDED.client_id, EXCLUDED.sequence, EXCLUDED.sequence_id, EXCLUDED.step,
           EXCLUDED.template, EXCLUDED.to_email, EXCLUDED.to_name, EXCLUDED.to_company, EXCLUDED.subject, EXCLUDED.sent_at,
           EXCLUDED.sent_date_pacific, EXCLUDED.scheduled_at, EXCLUDED.sent, EXCLUDED.bounced, EXCLUDED.opened, EXCLUDED.clicked,
           EXCLUDED.unsubscribed, EXCLUDED.replied, EXCLUDED.contact_stage, EXCLUDED.provider_synced_at, EXCLUDED.raw)
    RETURNING (xmax = 0) AS inserted`;
  const inserted = result.filter((x) => x.inserted).length;
  return { inserted, updated: result.length - inserted, unchanged: unique.length - result.length };
}

/** Reads one date window (the provider's dates) of emails from the API and stores it. Safe to repeat. */
export async function ingestEmailsWindow(ctx: EmailContext, from: string, to: string): Promise<WindowResult> {
  const out: WindowResult = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, distinct: 0, total: 0, passes: 0, unknownDispositions: {}, unknownDirections: {}, errors: [] };
  const w = await fetchWindow("/v1/emails", "apollo_message_id", from, to, async (items) => {
    const rows: EmailRow[] = [];
    for (const raw of items) {
      out.fetched++;
      try {
        rows.push(mapEmail(raw, ctx));
      } catch (e) {
        out.skipped++;
        if (out.errors.length < 5) out.errors.push(e instanceof Error ? e.message.slice(0, 300) : String(e));
      }
    }
    const r = await upsertEmails(rows);
    out.inserted += r.inserted;
    out.updated += r.updated;
    out.unchanged += r.unchanged;
  });
  return Object.assign(out, w);
}
