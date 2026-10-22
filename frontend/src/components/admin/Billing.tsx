"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, Pill, Table, TemplateLink, useAction, when } from "./parts";

type Change = { invoiceNo: string; kind: "added" | "changed"; fields: { field: string; from: unknown; to: unknown }[] };
type Preview = {
  stagedId: string; fileName: string; sheets: string[]; sheet: string; rows: number; added: number; changed: number; unchanged: number;
  changes: Change[]; flags: { invoiceNo: string; total: number; expected: number; difference: number }[]; errors: string[]; warnings: string[]; willCommit: boolean;
};
type Upload = { id: number; fileName: string | null; uploadedBy: string | null; uploadedAt: string; status: string; summary: { rows?: number; added?: number; changed?: number; flags?: number } | null };
type Summary = { orders: number; lastUpload: { id: number; at: string; by: string | null; fileName: string | null } | null };

const money = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "USD" });
const val = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : String(v ?? "—"));

export default function Billing() {
  const [tick, setTick] = useState(0);
  const summary = useApi<Summary>(`/admin/files/billing/summary?x=${tick}`);
  const history = useApi<Upload[]>(`/admin/files/billing/uploads?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check() {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    const p = await act.run(() => api<Preview>("/admin/files/billing/preview", { method: "POST", body: f }));
    if (p) setPreview(p);
  }
  async function commit() {
    if (!preview) return;
    const r = await act.run(() => api<{ committed: boolean; message?: string }>("/admin/files/billing/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName, sheet: preview.sheet }),
    }));
    if (!r) return;
    setDone(r.committed ? "Saved. The revenue figures are updated." : (r.message ?? "Nothing to save."));
    setPreview(null); setFile(null); setTick((t) => t + 1);
  }
  async function rollback(id: number) {
    const r = await act.run(() => api<{ rolledBack: boolean }>(`/admin/files/billing/uploads/${id}/rollback`, { method: "POST" }));
    if (r) { setDone(`Upload #${id} rolled back.`); setTick((t) => t + 1); }
  }

  return (
    <>
      <section className="panel">
        <header><h3>Billing sheet</h3></header>
        <Async state={summary}>
          {(s) => <p className="small">{s.orders.toLocaleString()} orders stored · last upload: <b>{s.lastUpload ? `${when(s.lastUpload.at)} by ${s.lastUpload.by ?? "—"}` : "never"}</b></p>}
        </Async>
        <p className="na">
          One row per order. An order is identified by its invoice / order number: a number already stored is updated, a new one is added, and rows you leave out are not touched.
          Needs Invoice no, Client, Representative, Order date and Total; Created date, Account, Subtotal, Tax, Tip, Fee and Discount are optional. <TemplateLink name="billing" label="Download the template" />
        </p>
        <div className="adm-form">
          <FilePick accept=".xlsx,.xlsm,.csv" label="Billing file" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); }} />
          <button className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
        </div>
        <ErrorBox error={act.error} problems={act.problems} />
        {done && <Notice kind="ok">{done}</Notice>}

        {preview && (
          <div className="adm-preview">
            <h4>{preview.fileName}{preview.sheets.length > 1 ? ` · sheet “${preview.sheet}”` : ""} · {preview.rows} orders</h4>
            {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
            {preview.flags.length > 0 && (
              <Notice kind="warn"><b>{preview.flags.length} order(s) where Total ≠ Subtotal + Tax + Tip + Fee − Discount</b> (they can still be saved):
                <ul>{preview.flags.slice(0, 20).map((f) => <li key={f.invoiceNo}>{f.invoiceNo}: total {money(f.total)}, expected {money(f.expected)} (off by {money(f.difference)})</li>)}</ul>
              </Notice>
            )}
            <p className="small"><b>{preview.added}</b> new · <b>{preview.changed}</b> changed · {preview.unchanged} unchanged</p>
            {!preview.willCommit && !preview.errors.length && <Notice kind="info">Nothing would change, so there is nothing to save.</Notice>}
            <Table head={["Invoice", "What", "Details"]} empty="No new or changed orders." rows={preview.changes.map((c) => [
              c.invoiceNo, c.kind === "added" ? "New" : "Changed",
              <span key="d" className="small">{c.fields.map((f) => `${f.field}: ${val(f.from)} → ${val(f.to)}`).join(" · ")}</span>,
            ])} />
            <div className="adm-actions">
              <button className="btn primary" disabled={!preview.willCommit || act.busy} onClick={commit}>{act.busy ? "Saving…" : "Save this upload"}</button>
              <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <header><h3>Upload history</h3></header>
        <p className="na">Only the latest upload can be rolled back (it puts changed orders back and removes the ones it added).</p>
        <Async state={history}>
          {(list) => {
            const latest = list.find((u) => u.status === "committed")?.id;
            return (
              <Table head={["#", "When", "File", "By", "New", "Changed", "Flagged", "Status", ""]} empty="No uploads yet." rows={list.map((u) => [
                u.id, when(u.uploadedAt), u.fileName ?? "—", u.uploadedBy ?? "—", u.summary?.added ?? 0, u.summary?.changed ?? 0, u.summary?.flags ?? 0, <Pill key="s" status={u.status} />,
                u.id === latest ? <button key="r" className="btn small" disabled={act.busy} onClick={() => confirm("Roll back the latest billing upload?") && rollback(u.id)}>Roll back</button> : "",
              ])} />
            );
          }}
        </Async>
      </section>
    </>
  );
}
