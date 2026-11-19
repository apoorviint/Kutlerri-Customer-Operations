"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, useAction, when } from "./parts";

type Preview = {
  stagedId: string; fileName: string; sheet: string; rows: number; shown: number; total: number;
  from: string | null; to: string | null; errors: string[]; warnings: string[]; willCommit: boolean;
};
type Summary = { rows: number; lastUpload: { at: string; by: string | null; fileName: string | null } | null };

const money = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "USD" });

/** The proposals sheet ("All MQL+ Proposal", tab "Proposals") behind the Forecast revenue tables. */
export default function Forecast() {
  const [tick, setTick] = useState(0);
  const summary = useApi<Summary>(`/admin/files/forecast/summary?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check() {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    const p = await act.run(() => api<Preview>("/admin/files/forecast/preview", { method: "POST", body: f }));
    if (p) setPreview(p);
  }
  async function commit() {
    if (!preview) return;
    const r = await act.run(() => api<{ committed: boolean }>("/admin/files/forecast/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName }),
    }));
    if (!r) return;
    setDone("Saved. The Forecast revenue tables are updated.");
    setPreview(null); setFile(null); setTick((t) => t + 1);
  }

  return (
    <section className="panel">
      <header><h3>Forecast sheet (proposals)</h3></header>
      <Async state={summary}>
        {(s) => <p className="small">{s.rows.toLocaleString()} proposals stored · last upload: <b>{s.lastUpload ? `${when(s.lastUpload.at)} by ${s.lastUpload.by ?? "—"}` : "never"}</b></p>}
      </Async>
      <p className="na">
        Upload the &ldquo;All MQL+ Proposal&rdquo; workbook. The &ldquo;Proposals&rdquo; tab is read: the Close Date (the day it is reported), the Item Total (the revenue), the Representative and the Client.
        Every upload replaces the earlier one. The tables show weeks from this week to 31 Dec and do not follow the date filter.
      </p>
      <div className="adm-form">
        <FilePick accept=".xlsx,.xlsm,.csv" label="Proposals file" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); }} />
        <button className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
      </div>
      <ErrorBox error={act.error} problems={act.problems} />
      {done && <Notice kind="ok">{done}</Notice>}

      {preview && (
        <div className="adm-preview">
          <h4>{preview.fileName} · tab “{preview.sheet}” · {preview.rows} proposals</h4>
          {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          {preview.warnings.length > 0 && <Notice kind="warn"><ul>{preview.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
          <p className="small">Close dates {preview.from ?? "—"} to {preview.to ?? "—"} · <b>{preview.shown}</b> proposals up to 31 Dec, worth <b>{money(preview.total)}</b></p>
          <div className="adm-actions">
            <button className="btn primary" disabled={!preview.willCommit || act.busy} onClick={commit}>{act.busy ? "Saving…" : "Save this upload"}</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
