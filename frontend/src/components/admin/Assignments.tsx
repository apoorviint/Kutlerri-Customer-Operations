"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, Pill, Table, TemplateLink, useAction, when } from "./parts";

type Period = { from: string; to: string | null; granularity: string; added: number; removed: number; changed: number; unchanged: number; examples: { added: string[]; removed: string[]; changed: string[] } };
type Preview = {
  stagedId: string; fileName: string; sheets: string[]; sheet: string; layout: string; rows: number; errors: string[]; warnings: string[]; periods: Period[];
  totals: { added: number; removed: number; changed: number; unchanged: number }; noChange: boolean; canCommit: boolean;
};
type Upload = { id: number; source: string; fileName: string | null; uploadedBy: string | null; uploadedAt: string; status: string; summary: { rows?: number; totals?: Record<string, number> } | null; _count: { assignments: number } };

const period = (p: Period) => (p.to ? (p.from === p.to ? p.from : `${p.from} → ${p.to}`) : `${p.from} onwards`);

export default function Assignments() {
  const [tick, setTick] = useState(0);
  const history = useApi<Upload[]>(`/admin/assignments/uploads?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check() {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    const p = await act.run(() => api<Preview>("/admin/files/assignments/preview", { method: "POST", body: f }));
    if (p) setPreview(p);
  }
  async function commit() {
    if (!preview) return;
    const r = await act.run(() => api<{ committed: boolean; message?: string; recalculating?: { from: string; to: string | null } }>("/admin/files/assignments/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName, sheet: preview.sheet }),
    }));
    if (!r) return;
    setDone(r.committed ? `Saved. The calls from ${r.recalculating?.from ?? "the start"} onwards are being recalculated in the background.` : (r.message ?? "Nothing to save."));
    setPreview(null); setFile(null); setTick((t) => t + 1);
  }
  async function rollback(id: number) {
    const r = await act.run(() => api<{ rolledBack: boolean }>(`/admin/assignments/uploads/${id}/rollback`, { method: "POST" }));
    if (r) { setDone(`Upload #${id} rolled back. The calls are being recalculated.`); setTick((t) => t + 1); }
  }

  return (
    <>
      <section className="panel">
        <header><h3>Who dialed for whom</h3></header>
        <p className="na">
          Upload the sheet that says which Representative used which phone line for which client. Use the old wide layout (one column per week, month or day) or the simple template with one row per line and day.
          A week, month or day in the file replaces that same period; periods not in the file are left alone. Upload a day sheet each day.
          {" "}<TemplateLink name="assignments" label="Download the daily template" /> · <TemplateLink name="assignments-weekly" label="weekly template" />
        </p>
        <div className="adm-form">
          <FilePick accept=".xlsx,.xlsm,.csv" label="Who dialed for whom file" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); }} />
          <button className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
        </div>
        <ErrorBox error={act.error} problems={act.problems} />
        {done && <Notice kind="ok">{done}</Notice>}

        {preview && (
          <div className="adm-preview">
            <h4>{preview.fileName}{preview.sheets.length > 1 ? ` · sheet “${preview.sheet}”` : ""} · {preview.layout} layout · {preview.rows.toLocaleString()} rows</h4>
            {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
            {preview.warnings.length > 0 && <Notice kind="warn"><b>Worth a look:</b><ul>{preview.warnings.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
            {preview.noChange && !preview.errors.length && <Notice kind="info">This file matches what is already saved, so nothing would change.</Notice>}
            <p className="small">What would change: <b>{preview.totals.added}</b> lines added · <b>{preview.totals.removed}</b> removed · <b>{preview.totals.changed}</b> changed · {preview.totals.unchanged} unchanged</p>
            <Table head={["Period", "Type", "Added", "Removed", "Changed", "Unchanged", "Examples"]} rows={preview.periods.map((p) => [
              period(p), p.granularity, p.added, p.removed, p.changed, p.unchanged,
              <span key="e" className="small">{[...p.examples.added.map((x) => `+ ${x}`), ...p.examples.removed.map((x) => `− ${x}`), ...p.examples.changed.map((x) => `~ ${x}`)].slice(0, 3).join(" · ")}</span>,
            ])} />
            <div className="adm-actions">
              <button className="btn primary" disabled={!preview.canCommit || preview.noChange || act.busy} onClick={commit}>{act.busy ? "Saving…" : "Save this upload"}</button>
              <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="adm-row"><h3>Upload history</h3></header>
        <Async state={history}>
          {(list) => (
            <Table head={["#", "When", "File", "By", "Rows", "Status", ""]} empty="No uploads yet." rows={list.map((u) => [
              u.id, when(u.uploadedAt), `${u.fileName ?? "—"}${u.source !== "upload" ? ` (${u.source})` : ""}`, u.uploadedBy ?? "—", u._count.assignments.toLocaleString(), <Pill key="s" status={u.status} />,
              u.status === "committed" ? <button key="r" className="btn small" disabled={act.busy} onClick={() => confirm("Roll this upload back? The rows it replaced come back.") && rollback(u.id)}>Roll back</button> : "",
            ])} />
          )}
        </Async>
      </section>
    </>
  );
}
