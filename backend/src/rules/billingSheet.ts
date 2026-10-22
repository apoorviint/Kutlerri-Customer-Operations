/**
 * Reads the billing sheet: one row per order. The order's unique key (invoice / order number) decides whether an
 * uploaded row adds a new order or updates an existing one.
 */
export type BillingRow = {
  rowNo: number;
  invoiceNo: string;
  client: string;
  representative: string;
  createdDate: string | null;
  orderDate: string;
  account: string | null;
  subtotal: number | null;
  tax: number | null;
  tip: number | null;
  fee: number | null;
  discount: number | null;
  total: number;
};

export type ParsedBilling = { rows: BillingRow[]; errors: string[]; warnings: string[]; columns: string[] };

const FIELDS: Record<string, RegExp> = {
  invoiceNo: /^(invoice|order)[\s_#.-]*(no\.?|number|num|id|key|#)?$/i,
  client: /^(client|customer)(\s*name)?$/i,
  representative: /^(rep|representative|sales\s*rep|owner)(\s*name)?$/i,
  createdDate: /^(created|creation)[\s_]*(date|at|on)?$/i,
  orderDate: /^(order[\s_]*date|date|event[\s_]*date|delivery[\s_]*date)$/i,
  account: /^(account|company|account\s*name)$/i,
  subtotal: /^sub[\s_-]*total$/i,
  tax: /^(sales\s*)?tax$/i,
  tip: /^(tip|gratuity)$/i,
  fee: /^(fee|fees|service[\s_]*fee|delivery[\s_]*fee)$/i,
  discount: /^(discount|discounts|promo)$/i,
  total: /^(grand[\s_]*)?total(\s*amount)?$/i,
};

const text = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" ? String((v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? "") : String(v)).trim();

export function cellDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10); // an Excel date number
  const s = text(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // US style: month first
  if (m) return ok(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  const t = Date.parse(s + " UTC");
  return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}
function ok(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

export function cellMoney(v: unknown): number | null | "bad" {
  if (v == null || text(v) === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : "bad";
  const s = text(v).replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(s);
  const n = Number(neg ? s.slice(1, -1) : s);
  return Number.isFinite(n) && s !== "" ? Math.round((neg ? -n : n) * 100) / 100 : "bad";
}

export function parseBillingSheet(grid: unknown[][]): ParsedBilling {
  const out: ParsedBilling = { rows: [], errors: [], warnings: [], columns: [] };
  const head = grid.findIndex((r) => Array.isArray(r) && r.filter((c) => text(c) !== "").length >= 3 && r.some((c) => FIELDS.invoiceNo.test(text(c))) && r.some((c) => FIELDS.total.test(text(c))));
  if (head < 0) {
    out.errors.push("Could not find the header row. It needs at least an Invoice (or Order) number column and a Total column; download the template to see the layout.");
    return out;
  }
  const idx: Partial<Record<keyof typeof FIELDS, number>> = {};
  grid[head].forEach((h, i) => {
    const s = text(h);
    if (!s) return;
    for (const [k, re] of Object.entries(FIELDS)) if (idx[k] === undefined && re.test(s)) { idx[k] = i; break; }
  });
  out.columns = Object.keys(idx);
  for (const need of ["client", "representative", "orderDate"] as const) if (idx[need] === undefined) out.errors.push(`The sheet has no "${need === "orderDate" ? "Order date" : need === "representative" ? "Representative" : "Client"}" column.`);
  if (out.errors.length) return out;

  const seen = new Map<string, number>();
  for (let i = head + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!Array.isArray(r) || r.every((c) => text(c) === "")) continue;
    const rowNo = i + 1;
    const get = (k: string) => (idx[k] === undefined ? undefined : r[idx[k]!]);
    const invoiceNo = text(get("invoiceNo"));
    if (!invoiceNo) { out.errors.push(`Row ${rowNo}: no invoice / order number.`); continue; }
    if (seen.has(invoiceNo)) { out.errors.push(`Row ${rowNo}: invoice ${invoiceNo} also appears in row ${seen.get(invoiceNo)}. Each order may appear once.`); continue; }
    seen.set(invoiceNo, rowNo);
    const orderDate = cellDate(get("orderDate"));
    if (!orderDate) { out.errors.push(`Row ${rowNo} (${invoiceNo}): the order date is missing or not a date.`); continue; }
    const money: Record<string, number | null> = {};
    let bad = false;
    for (const k of ["subtotal", "tax", "tip", "fee", "discount", "total"]) {
      const v = cellMoney(get(k));
      if (v === "bad") { out.errors.push(`Row ${rowNo} (${invoiceNo}): "${k}" is not a number.`); bad = true; }
      else money[k] = v;
    }
    if (bad) continue;
    if (money.total === null) { out.errors.push(`Row ${rowNo} (${invoiceNo}): the total is missing.`); continue; }
    out.rows.push({
      rowNo, invoiceNo, client: text(get("client")), representative: text(get("representative")),
      createdDate: cellDate(get("createdDate")), orderDate, account: text(get("account")) || null,
      subtotal: money.subtotal, tax: money.tax, tip: money.tip, fee: money.fee, discount: money.discount, total: money.total,
    });
  }
  if (!out.rows.length && !out.errors.length) out.errors.push("The sheet has a header but no orders.");
  return out;
}

/**
 * Total should equal Subtotal + Tax + Tip + Fee − Discount. Returns how far off it is, or null when it matches, or when there is
 * nothing to check against (no subtotal, or no tax / tip / fee / discount given at all, as for the orders carried over from the prototype).
 */
export function totalMismatch(o: { subtotal: number | null; tax: number | null; tip: number | null; fee: number | null; discount: number | null; total: number }): number | null {
  if (o.subtotal === null || (o.tax === null && o.tip === null && o.fee === null && o.discount === null)) return null;
  const expected = o.subtotal + (o.tax ?? 0) + (o.tip ?? 0) + (o.fee ?? 0) - (o.discount ?? 0);
  const diff = Math.round((o.total - expected) * 100) / 100;
  return Math.abs(diff) > 0.01 ? diff : null;
}
