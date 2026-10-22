import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { parseBillingSheet, totalMismatch, type BillingRow, type ParsedBilling } from "../rules/billingSheet.js";
import { loadLookups, norm } from "./assignments.js";
import { audit } from "./audit.js";
import { clearCache } from "./cache.js";

export class BillingValidationError extends Error {
  constructor(public errors: string[]) {
    super("The billing sheet has problems");
  }
}

type Money = number | null;
export type OrderValues = {
  invoiceNo: string; clientId: number; representativeId: number; createdDate: string | null; orderDate: string; account: string | null;
  subtotal: Money; tax: Money; tip: Money; fee: Money; discount: Money; total: number;
};

const d = (v: Prisma.Decimal | null | undefined): Money => (v == null ? null : Number(v));
const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);
const FIELDS = ["clientId", "representativeId", "createdDate", "orderDate", "account", "subtotal", "tax", "tip", "fee", "discount", "total"] as const;

type Stored = Awaited<ReturnType<typeof db.billingOrder.findMany>>[number];
const asValues = (o: Stored): OrderValues => ({
  invoiceNo: o.invoiceNo, clientId: o.clientId, representativeId: o.representativeId, createdDate: day(o.createdDate), orderDate: day(o.orderDate)!,
  account: o.account, subtotal: d(o.subtotal), tax: d(o.tax), tip: d(o.tip), fee: d(o.fee), discount: d(o.discount), total: Number(o.total),
});

export type BillingPreview = {
  rows: number;
  added: number; changed: number; unchanged: number;
  changes: { invoiceNo: string; kind: "added" | "changed"; fields: { field: string; from: unknown; to: unknown }[] }[];
  flags: { invoiceNo: string; total: number; expected: number; difference: number }[]; // Total is not Subtotal + Tax + Tip + Fee − Discount
  errors: string[];
  warnings: string[];
  willCommit: boolean;
};

export async function resolveBilling(parsed: ParsedBilling): Promise<{ values: OrderValues[]; errors: string[] }> {
  const lk = await loadLookups();
  const errors = [...parsed.errors];
  const values: OrderValues[] = [];
  for (const r of parsed.rows) {
    const client = lk.clients.get(norm(r.client)), rep = lk.reps.get(norm(r.representative));
    if (!client) { errors.push(`Row ${r.rowNo} (${r.invoiceNo}): unknown client "${r.client}". Add it under Mappings first, or fix the name.`); continue; }
    if (!rep) { errors.push(`Row ${r.rowNo} (${r.invoiceNo}): unknown Representative "${r.representative}".`); continue; }
    values.push({
      invoiceNo: r.invoiceNo, clientId: client.id, representativeId: rep.id, createdDate: r.createdDate, orderDate: r.orderDate, account: r.account,
      subtotal: r.subtotal, tax: r.tax, tip: r.tip, fee: r.fee, discount: r.discount, total: r.total,
    });
  }
  return { values, errors };
}

export async function previewBilling(grid: unknown[][]): Promise<BillingPreview & { values: OrderValues[] }> {
  const parsed = parseBillingSheet(grid);
  const { values, errors } = await resolveBilling(parsed);
  const existing = new Map((await db.billingOrder.findMany({ where: { invoiceNo: { in: values.map((v) => v.invoiceNo) } } })).map((o) => [o.invoiceNo, asValues(o)]));
  const [clients, reps] = await Promise.all([db.client.findMany(), db.representative.findMany()]);
  const label = (f: string, v: unknown) => (f === "clientId" ? (clients.find((c) => c.id === v)?.name ?? v) : f === "representativeId" ? (reps.find((r) => r.id === v)?.name ?? v) : v);

  const out: BillingPreview = { rows: parsed.rows.length, added: 0, changed: 0, unchanged: 0, changes: [], flags: [], errors, warnings: parsed.warnings, willCommit: false };
  for (const v of values) {
    const before = existing.get(v.invoiceNo);
    if (!before) { out.added++; out.changes.push({ invoiceNo: v.invoiceNo, kind: "added", fields: [] }); }
    else {
      const fields = FIELDS.filter((f) => before[f] !== v[f]).map((f) => ({ field: f.replace(/Id$/, ""), from: label(f, before[f]), to: label(f, v[f]) }));
      if (fields.length) { out.changed++; out.changes.push({ invoiceNo: v.invoiceNo, kind: "changed", fields }); } else out.unchanged++;
    }
    const diff = totalMismatch(v);
    if (diff !== null) out.flags.push({ invoiceNo: v.invoiceNo, total: v.total, expected: Math.round((v.total - diff) * 100) / 100, difference: diff });
  }
  out.changes = out.changes.slice(0, 200);
  out.willCommit = !errors.length && out.added + out.changed > 0;
  return { ...out, values };
}

export async function commitBilling(
  grid: unknown[][], meta: { fileName?: string; fileHash?: string; uploadedBy: string },
): Promise<{ committed: false; preview: BillingPreview } | { committed: true; uploadId: number; preview: BillingPreview }> {
  const { values, ...preview } = await previewBilling(grid);
  if (preview.errors.length) throw new BillingValidationError(preview.errors);
  if (!preview.added && !preview.changed) return { committed: false, preview };

  const upload = await db.$transaction(async (tx) => {
    const up = await tx.billingUpload.create({
      data: { fileName: meta.fileName, fileHash: meta.fileHash, uploadedBy: meta.uploadedBy, summary: { rows: preview.rows, added: preview.added, changed: preview.changed, unchanged: preview.unchanged, flags: preview.flags.length } },
    });
    const existing = new Map((await tx.billingOrder.findMany({ where: { invoiceNo: { in: values.map((v) => v.invoiceNo) } } })).map((o) => [o.invoiceNo, asValues(o)]));
    for (const v of values) {
      const before = existing.get(v.invoiceNo);
      if (before && FIELDS.every((f) => before[f] === v[f])) continue; // untouched rows are left alone
      const data = {
        clientId: v.clientId, representativeId: v.representativeId, createdDate: v.createdDate ? new Date(v.createdDate) : null, orderDate: new Date(v.orderDate),
        account: v.account, subtotal: v.subtotal, tax: v.tax, tip: v.tip, fee: v.fee, discount: v.discount, total: v.total, uploadId: up.id,
      };
      await tx.billingChange.create({ data: { uploadId: up.id, invoiceNo: v.invoiceNo, before: before ? JSON.parse(JSON.stringify(before)) : Prisma.JsonNull } });
      await tx.billingOrder.upsert({ where: { invoiceNo: v.invoiceNo }, create: { invoiceNo: v.invoiceNo, ...data }, update: data });
    }
    return up;
  });
  await audit(meta.uploadedBy, "billing.upload", meta.fileName ?? null, { uploadId: upload.id, added: preview.added, changed: preview.changed, flags: preview.flags.length });
  clearCache();
  return { committed: true, uploadId: upload.id, preview };
}

/** Undoes the most recent billing upload (earlier ones can only be undone after it, so no later change is overwritten). */
export async function rollbackBilling(uploadId: number, by: string) {
  const up = await db.billingUpload.findUnique({ where: { id: uploadId } });
  if (!up) throw new Error("No such upload");
  if (up.status !== "committed") throw new Error("This upload is already rolled back");
  const later = await db.billingUpload.findFirst({ where: { status: "committed", id: { gt: uploadId } } });
  if (later) throw new Error(`Upload #${later.id} was made after this one; roll that back first`);
  await db.$transaction(async (tx) => {
    for (const c of await tx.billingChange.findMany({ where: { uploadId } })) {
      if (c.before === null) await tx.billingOrder.deleteMany({ where: { invoiceNo: c.invoiceNo } });
      else {
        const b = c.before as unknown as OrderValues;
        const data = {
          clientId: b.clientId, representativeId: b.representativeId, createdDate: b.createdDate ? new Date(b.createdDate) : null, orderDate: new Date(b.orderDate),
          account: b.account, subtotal: b.subtotal, tax: b.tax, tip: b.tip, fee: b.fee, discount: b.discount, total: b.total,
        };
        await tx.billingOrder.update({ where: { invoiceNo: c.invoiceNo }, data });
      }
    }
    await tx.billingUpload.update({ where: { id: uploadId }, data: { status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: by } });
  });
  await audit(by, "billing.rollback", `upload #${uploadId}`);
  clearCache();
}

export type { BillingRow };
