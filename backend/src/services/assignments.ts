import { createHash } from "node:crypto";
import { db } from "../db.js";
import { agentKey } from "../rules/calls.js";
import { findSuspiciousSwaps, type Assignment, type SheetRow } from "../rules/assignments.js";
import type { ParsedRow } from "../rules/assignmentSheet.js";
import type { Granularity } from "../rules/periods.js";

export class AssignmentValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors[0] ?? "Invalid sheet");
  }
}

export type StoredAssignment = Assignment & { granularity: string; repName: string; clientName: string };

const apostrophes = /[’‘`´]/g;
export const norm = (s: string) => s.replace(apostrophes, "'").trim().replace(/\s+/g, " ").toLowerCase();

/** Every assignment currently in force: not replaced by a later upload, and its upload not rolled back. */
export async function loadActiveAssignments(): Promise<StoredAssignment[]> {
  const rows = await db.$queryRaw<
    { id: number; phone_no10: string; representative_id: number; client_id: number; kind: string; rep: string; client: string; vf: string; vt: string | null; granularity: string; priority: number }[]
  >`
    SELECT la.id, la.phone_no10, la.representative_id, la.client_id, c.kind::text AS kind, r.name AS rep, c.name AS client,
           to_char(la.valid_from, 'YYYY-MM-DD') AS vf, to_char(la.valid_to, 'YYYY-MM-DD') AS vt, la.granularity, la.priority
    FROM line_assignments la
    JOIN clients c ON c.id = la.client_id
    JOIN representatives r ON r.id = la.representative_id
    JOIN assignment_uploads u ON u.id = la.upload_id
    WHERE la.superseded_by_upload_id IS NULL AND u.status = 'committed'`;
  return rows.map((r) => ({
    id: r.id, phoneNo10: r.phone_no10, representativeId: r.representative_id, clientId: r.client_id,
    clientKind: r.kind as "CUSTOMER" | "INTERNAL", validFrom: r.vf, validTo: r.vt, priority: r.priority,
    granularity: r.granularity, repName: r.rep, clientName: r.client,
  }));
}

// ───────────── turning the names in a sheet into ids ─────────────

export type Lookups = { reps: Map<string, { id: number; name: string }>; clients: Map<string, { id: number; name: string }> };

export async function loadLookups(): Promise<Lookups> {
  const [reps, clients, agents] = await Promise.all([
    db.representative.findMany(), db.client.findMany(), db.agent.findMany({ where: { representativeId: { not: null } }, include: { representative: true } }),
  ]);
  const repMap = new Map(reps.map((r) => [norm(r.name), { id: r.id, name: r.name }]));
  // a sheet may name the real person (the agent) instead of the working name: accept it and use the Representative
  for (const a of agents) if (!repMap.has(norm(a.name))) repMap.set(norm(a.name), { id: a.representative!.id, name: a.representative!.name });
  return { reps: repMap, clients: new Map(clients.map((c) => [norm(c.name), { id: c.id, name: c.name }])) };
}

export type ResolvedRow = {
  phoneNo10: string; representativeId: number; repName: string; clientId: number; clientName: string;
  from: string; to: string | null; granularity: Granularity; priority: number;
};

function resolveRows(parsed: ParsedRow[], lk: Lookups, priority: number) {
  const errors: string[] = [];
  const unknownReps = new Map<string, number[]>(), unknownClients = new Map<string, number[]>();
  const seen = new Set<string>();
  const rows: ResolvedRow[] = [];
  for (const p of parsed) {
    const rep = lk.reps.get(norm(p.representative)), client = lk.clients.get(norm(p.client));
    if (!rep) (unknownReps.get(p.representative) ?? unknownReps.set(p.representative, []).get(p.representative)!).push(p.rowNo);
    if (!client) (unknownClients.get(p.client) ?? unknownClients.set(p.client, []).get(p.client)!).push(p.rowNo);
    if (!rep || !client) continue;
    const key = `${p.phoneNo10}|${rep.id}|${client.id}|${p.from}|${p.to}|${p.granularity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ phoneNo10: p.phoneNo10, representativeId: rep.id, repName: rep.name, clientId: client.id, clientName: client.name, from: p.from, to: p.to, granularity: p.granularity, priority });
  }
  const rowsText = (n: number[]) => `row${n.length > 1 ? "s" : ""} ${[...new Set(n)].slice(0, 8).join(", ")}${new Set(n).size > 8 ? "…" : ""}`;
  for (const [name, n] of unknownReps) errors.push(`Unknown Representative "${name}" (${rowsText(n)}). Add them first or correct the name.`);
  for (const [name, n] of unknownClients) errors.push(`Unknown client "${name}" (${rowsText(n)}).`);
  return { rows, errors };
}

// ───────────── preview ─────────────

export type PeriodDiff = {
  from: string; to: string | null; granularity: string;
  added: number; removed: number; changed: number; unchanged: number;
  examples: { added: string[]; removed: string[]; changed: string[] };
};

export type AssignmentPreview = {
  layout: string;
  rows: number;
  errors: string[]; // anything here blocks the upload
  warnings: string[];
  periods: PeriodDiff[];
  totals: { added: number; removed: number; changed: number; unchanged: number };
  noChange: boolean;
  canCommit: boolean;
};

type Input = { rows: ParsedRow[]; errors?: string[]; warnings?: string[]; layout?: string };

const periodKey = (r: { from: string; to: string | null; granularity: string; priority: number }) => `${r.from}|${r.to ?? ""}|${r.granularity}|${r.priority}`;
const rowKey = (r: { phoneNo10: string; representativeId: number; clientId: number }) => `${r.phoneNo10}|${r.representativeId}|${r.clientId}`;

export async function previewAssignments(input: Input, opts: { priority?: number } = {}): Promise<AssignmentPreview & { resolved: ResolvedRow[] }> {
  const priority = opts.priority ?? 1;
  const errors = [...(input.errors ?? [])];
  const warnings = [...(input.warnings ?? [])];
  const lk = await loadLookups();
  const { rows, errors: nameErrors } = resolveRows(input.rows, lk, priority);
  errors.push(...nameErrors);

  // one phone line on two different clients in the same period: the sheet cannot be right
  const byPeriodPhone = new Map<string, ResolvedRow[]>();
  for (const r of rows) (byPeriodPhone.get(`${periodKey(r)}|${r.phoneNo10}`) ?? byPeriodPhone.set(`${periodKey(r)}|${r.phoneNo10}`, []).get(`${periodKey(r)}|${r.phoneNo10}`)!).push(r);
  for (const list of byPeriodPhone.values()) {
    const clients = new Set(list.map((r) => r.clientName));
    const reps = new Set(list.map((r) => r.repName));
    const at = `${list[0].from}${list[0].to && list[0].to !== list[0].from ? ` to ${list[0].to}` : ""}`;
    if (clients.size > 1) errors.push(`Line …${list[0].phoneNo10.slice(-4)} is assigned to two clients (${[...clients].join(" and ")}) in the same period (${at}). Fix the sheet, then upload again.`);
    else if (reps.size > 1) warnings.push(`Line …${list[0].phoneNo10.slice(-4)} is shared by ${[...reps].join(" and ")} on ${list[0].clientName} (${at}). Calls on it are attributed by the agent who made them.`);
  }

  // compare with what is in force now, period by period
  const active = await loadActiveAssignments();
  const existing = new Map<string, StoredAssignment[]>();
  for (const a of active) (existing.get(periodKey({ from: a.validFrom, to: a.validTo, granularity: a.granularity, priority: a.priority })) ?? existing.set(periodKey({ from: a.validFrom, to: a.validTo, granularity: a.granularity, priority: a.priority }), []).get(periodKey({ from: a.validFrom, to: a.validTo, granularity: a.granularity, priority: a.priority }))!).push(a);

  const incoming = new Map<string, ResolvedRow[]>();
  for (const r of rows) (incoming.get(periodKey(r)) ?? incoming.set(periodKey(r), []).get(periodKey(r))!).push(r);

  const periods: PeriodDiff[] = [];
  for (const [key, list] of [...incoming].sort(([a], [b]) => a.localeCompare(b))) {
    const old = existing.get(key) ?? [];
    const oldKeys = new Map(old.map((o) => [rowKey(o), o]));
    const newKeys = new Map(list.map((n) => [rowKey(n), n]));
    const added = list.filter((n) => !oldKeys.has(rowKey(n)));
    const removed = old.filter((o) => !newKeys.has(rowKey(o)));
    const oldPhones = new Map(removed.map((o) => [o.phoneNo10, o]));
    const changed = added.filter((n) => oldPhones.has(n.phoneNo10));
    const changedPhones = new Set(changed.map((c) => c.phoneNo10));
    const trulyAdded = added.filter((n) => !changedPhones.has(n.phoneNo10));
    const trulyRemoved = removed.filter((o) => !changedPhones.has(o.phoneNo10));
    const f = list[0];
    const show = (r: { phoneNo10: string; repName: string; clientName: string }) => `…${r.phoneNo10.slice(-4)} ${r.repName} / ${r.clientName}`;
    periods.push({
      from: f.from, to: f.to, granularity: f.granularity,
      added: trulyAdded.length, removed: trulyRemoved.length, changed: changed.length, unchanged: list.length - added.length,
      examples: {
        added: trulyAdded.slice(0, 5).map(show), removed: trulyRemoved.slice(0, 5).map(show),
        changed: changed.slice(0, 5).map((n) => `${show(oldPhones.get(n.phoneNo10)!)}  ->  ${n.repName} / ${n.clientName}`),
      },
    });
  }

  // a possible mistyped column (two numbers whose clients trade places): reported, never corrected
  const replaced = new Set(incoming.keys());
  const sheetRows: SheetRow[] = [
    ...rows.map((r) => ({ phoneNo10: r.phoneNo10, representative: r.repName, client: r.clientName, from: r.from, to: r.to })),
    ...active.filter((a) => !replaced.has(periodKey({ from: a.validFrom, to: a.validTo, granularity: a.granularity, priority: a.priority })) && a.priority === priority)
      .map((a) => ({ phoneNo10: a.phoneNo10, representative: a.repName, client: a.clientName, from: a.validFrom, to: a.validTo })),
  ];
  const incomingStarts = new Set(rows.map((r) => r.from));
  for (const s of findSuspiciousSwaps(sheetRows)) {
    // only report a mix-up in the periods being uploaded, not one that was already there (and already reported)
    if (!incomingStarts.has(s.between[0]) && !incomingStarts.has(s.between[1])) continue;
    warnings.push(`Possible mix-up: ${s.representative}'s lines …${s.phones[0].slice(-4)} and …${s.phones[1].slice(-4)} swap clients (${s.clients[0]} and ${s.clients[1]}) between the weeks of ${s.between[0]} and ${s.between[1]}. Imported as written; please check the sheet.`);
  }

  const totals = periods.reduce((t, p) => ({ added: t.added + p.added, removed: t.removed + p.removed, changed: t.changed + p.changed, unchanged: t.unchanged + p.unchanged }), { added: 0, removed: 0, changed: 0, unchanged: 0 });
  const noChange = rows.length > 0 && totals.added + totals.removed + totals.changed === 0;
  return {
    layout: input.layout ?? "unknown", rows: rows.length, errors, warnings, periods, totals, noChange,
    canCommit: errors.length === 0 && rows.length > 0, resolved: rows,
  };
}

// ───────────── commit and rollback ─────────────

export type CommitMeta = { source?: "upload" | "reference-import" | "override"; fileName?: string; fileHash?: string; uploadedBy?: string; force?: boolean; priority?: number };

export type CommitResult =
  | { committed: false; noChange: true; preview: AssignmentPreview }
  | { committed: true; uploadId: number; preview: AssignmentPreview; range: { from: string; to: string | null } };

const rangeOf = (rows: { from: string; to: string | null }[]) => ({
  from: rows.reduce((m, r) => (r.from < m ? r.from : m), rows[0].from),
  to: rows.some((r) => r.to === null) ? null : rows.reduce((m, r) => (r.to! > m ? r.to! : m), rows[0].to!),
});

/**
 * Saves an upload. Each period the file contains is replaced as a whole (a re-upload of a week replaces that week);
 * periods it does not contain are never touched. Nothing is deleted: replaced rows are marked, so a rollback can bring them back.
 * An upload that would change nothing is not saved (so uploading the same file twice cannot double anything).
 */
export async function commitAssignments(input: Input, meta: CommitMeta = {}): Promise<CommitResult> {
  const { resolved, ...preview } = await previewAssignments(input, { priority: meta.priority });
  if (!preview.canCommit) throw new AssignmentValidationError(preview.errors.length ? preview.errors : ["The sheet has no usable rows."]);
  if (preview.noChange && !meta.force) return { committed: false, noChange: true, preview };

  const priority = meta.priority ?? 1;
  const uploadId = await db.$transaction(
    async (tx) => {
      const upload = await tx.assignmentUpload.create({
        data: { source: meta.source ?? "upload", fileName: meta.fileName, fileHash: meta.fileHash, uploadedBy: meta.uploadedBy, summary: JSON.parse(JSON.stringify({ totals: preview.totals, periods: preview.periods.length, warnings: preview.warnings })) },
      });
      const keys = new Map<string, ResolvedRow>();
      for (const r of resolved) keys.set(periodKey(r), r);
      for (const r of keys.values()) {
        await tx.lineAssignment.updateMany({
          where: {
            validFrom: new Date(r.from), validTo: r.to ? new Date(r.to) : null, granularity: r.granularity, priority,
            supersededByUploadId: null, upload: { status: "committed" },
          },
          data: { supersededByUploadId: upload.id },
        });
      }
      await tx.lineAssignment.createMany({
        data: resolved.map((r) => ({
          phoneNo10: r.phoneNo10, representativeId: r.representativeId, clientId: r.clientId, validFrom: new Date(r.from),
          validTo: r.to ? new Date(r.to) : null, granularity: r.granularity, priority, uploadId: upload.id,
        })),
      });
      return upload.id;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
  return { committed: true, uploadId, preview, range: rangeOf(resolved) };
}

/** Undoes an upload: its rows stop counting and the rows it replaced count again. */
export async function rollbackUpload(uploadId: number, by?: string): Promise<{ range: { from: string; to: string | null } | null }> {
  const upload = await db.assignmentUpload.findUnique({ where: { id: uploadId } });
  if (!upload) throw new Error("Upload not found");
  if (upload.status === "rolled_back") throw new Error("This upload was already rolled back");
  const mine = await db.lineAssignment.findMany({ where: { uploadId }, select: { validFrom: true, validTo: true } });
  await db.$transaction([
    db.assignmentUpload.update({ where: { id: uploadId }, data: { status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: by } }),
    db.lineAssignment.updateMany({ where: { supersededByUploadId: uploadId }, data: { supersededByUploadId: null } }),
  ]);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { range: mine.length ? rangeOf(mine.map((m) => ({ from: day(m.validFrom), to: m.validTo ? day(m.validTo) : null }))) : null };
}

export const fileHash = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");
export { agentKey };
