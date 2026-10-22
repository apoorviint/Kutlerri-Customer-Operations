/**
 * Reading a client's prospect database (an xlsx or csv, often several sheets) and working out who a phone number belongs to.
 *
 * Columns are found from the header row: First Name + Last Name, or Name; Title; Company; and every header that
 * contains "phone" or "mobile" except those that contain "HQ" (a head-office number is not the person's).
 */
export type Columns = { first: number; last: number; name: number; title: number; company: number; phones: number[] };

const text = (v: unknown) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" ? String((v as { text?: unknown; result?: unknown }).text ?? (v as { result?: unknown }).result ?? "") : String(v)).trim();
const has = (s: string, re: RegExp) => re.test(s.toLowerCase());

export function detectColumns(header: unknown[]): Columns | null {
  const c: Columns = { first: -1, last: -1, name: -1, title: -1, company: -1, phones: [] };
  header.forEach((h, i) => {
    const s = text(h);
    if (!s) return;
    if (has(s, /phone|mobile/)) {
      if (!has(s, /hq/)) c.phones.push(i); // "HQ Phone" is the company's switchboard
      return;
    }
    if (c.first < 0 && has(s, /^first[\s_-]*name$/)) c.first = i;
    else if (c.last < 0 && has(s, /^last[\s_-]*name$/)) c.last = i;
    else if (c.name < 0 && has(s, /^(full[\s_-]*|contact[\s_-]*)?name$/)) c.name = i;
    else if (c.title < 0 && has(s, /title|designation|job[\s_-]*role|position/)) c.title = i;
    else if (c.company < 0 && has(s, /^(company|organi[sz]ation|account)(\s*name)?$|^company/)) c.company = i;
  });
  const hasName = c.name >= 0 || c.first >= 0 || c.last >= 0;
  return c.phones.length && hasName ? c : null;
}

/** The header is the first of the opening rows that yields columns (some files start with a title line). */
export function findHeader(rows: unknown[][]): { index: number; columns: Columns } | null {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const columns = detectColumns(rows[i] ?? []);
    if (columns) return { index: i, columns };
  }
  return null;
}

/** All ten-digit numbers written in one cell. A cell may hold several ("555-111-2222; 555-333-4444"). */
export function phonesIn(cell: unknown): string[] {
  const raw = typeof cell === "number" ? String(Math.round(cell)) : text(cell);
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[;,/\n|]+|\s+or\s+/i)) {
    let d = part.replace(/(ext|x)\.?\s*\d+\s*$/i, "").replace(/\D/g, "");
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    if (d.length === 10) out.add(d);
    else if (d.length > 10 && d.length <= 13) out.add(d.slice(-10));
  }
  return [...out];
}

export type Contact = { phoneNo10: string; name: string; title: string; company: string };

export function contactsFromRow(row: unknown[], c: Columns): Contact[] {
  const name = c.name >= 0 ? text(row[c.name]) : [c.first >= 0 ? text(row[c.first]) : "", c.last >= 0 ? text(row[c.last]) : ""].filter(Boolean).join(" ");
  const title = c.title >= 0 ? text(row[c.title]) : "";
  const company = c.company >= 0 ? text(row[c.company]) : "";
  const phones = new Set<string>();
  for (const i of c.phones) for (const p of phonesIn(row[i])) phones.add(p);
  return [...phones].map((phoneNo10) => ({ phoneNo10, name, title, company }));
}

export type Match = { kind: "one" | "multiple"; name: string; company: string; title: string | null; candidates: string | null };

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Who a phone number belongs to, given everyone in one client's databases who has it:
 *  - one distinct person (same name and company): their name, title and company;
 *  - several: "Multiple contacts", the company if they all share it (else "Multiple companies"),
 *    and the candidates as "Name (Title)", the first 6 and then "+N more".
 */
export function summarizeContacts(list: { name: string; title: string; company: string }[]): Match | null {
  const people = new Map<string, { name: string; title: string; company: string }>();
  for (const p of list) {
    const k = `${key(p.name)}|${key(p.company)}`;
    const seen = people.get(k);
    if (!seen) people.set(k, { ...p });
    else if (!seen.title && p.title) seen.title = p.title;
  }
  const all = [...people.values()];
  if (!all.length) return null;
  if (all.length === 1) {
    const p = all[0];
    return { kind: "one", name: p.name, company: p.company, title: p.title || null, candidates: null };
  }
  const companies = new Set(all.map((p) => key(p.company)).filter(Boolean));
  const shown = all.slice(0, 6).map((p) => (p.title ? `${p.name} (${p.title})` : p.name));
  if (all.length > 6) shown.push(`+${all.length - 6} more`);
  return {
    kind: "multiple",
    name: "Multiple contacts",
    company: companies.size === 1 ? (all.find((p) => p.company)?.company ?? "") : "Multiple companies",
    title: null,
    candidates: shown.join(", "),
  };
}
