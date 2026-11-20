"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { LABELS } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { DispositionKey } from "@/lib/types";
import { ErrorBox, FilePick, Notice, Table, useAction, when } from "./parts";

type Preview = {
  stagedId: string; fileName: string; rows: number; newCalls: number; existing: number; from: string | null; to: string | null;
  dispositions: { value: string; count: number; saved: boolean; key: DispositionKey | null }[];
  members: { name: string; calls: number; representative: string | null }[];
  errors: string[]; warnings: string[]; willCommit: boolean;
};
type Summary = { calls: number; latest: string | null; lastUpload: string | null };

const OURS = Object.keys(LABELS) as DispositionKey[];

/** Calls exported from the calling app: added to the same calls as JustCall's, with the app's dispositions mapped to ours. */
export default function AppCalls() {
  const [tick, setTick] = useState(0);
  const summary = useApi<Summary>(`/admin/files/app-calls/summary?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [map, setMap] = useState<Record<string, string>>({}); // the app's disposition -> ours ("" = none)
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check() {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    const p = await act.run(() => api<Preview>("/admin/files/app-calls/preview", { method: "POST", body: f }));
    if (!p) return;
    setPreview(p);
    setMap(Object.fromEntries(p.dispositions.map((d) => [d.value, d.key ?? ""])));
  }
  async function commit() {
    if (!preview) return;
    const mapping = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v || null]));
    const r = await act.run(() => api<{ committed: boolean; inserted: number; updated: number; unchanged: number }>("/admin/files/app-calls/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName, mapping }),
    }));
    if (!r) return;
    setDone(`Saved. ${r.inserted} new call${r.inserted === 1 ? "" : "s"}, ${r.updated} updated, ${r.unchanged} unchanged. The dashboards are updated.`);
    setPreview(null); setFile(null); setTick((t) => t + 1);
  }

  return (
    <section className="panel">
      <header><h3>Calls from the app</h3></header>
      <Async state={summary}>
        {(s) => <p className="small">{s.calls.toLocaleString()} calls from the app stored · last upload: <b>{when(s.lastUpload)}</b></p>}
      </Async>
      <p className="na">
        Upload the app&rsquo;s call export. The header row is found by its column names, wherever it is in the sheet. Each call is saved once by its Call id, so a bigger export that repeats earlier calls only adds the new ones.
        The Member is the Representative, the Store number is the line, and the Duration (s) is the call length. Calls are added to the same data as the rest.
      </p>
      <div className="adm-form">
        <FilePick accept=".xlsx,.xlsm,.csv" label="App calls file" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); }} />
        <button className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
      </div>
      <ErrorBox error={act.error} problems={act.problems} />
      {done && <Notice kind="ok">{done}</Notice>}

      {preview && (
        <div className="adm-preview">
          <h4>{preview.fileName} · {preview.rows.toLocaleString()} calls</h4>
          {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          {preview.warnings.length > 0 && <Notice kind="warn"><ul>{preview.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
          <p className="small"><b>{preview.newCalls.toLocaleString()}</b> new · {preview.existing.toLocaleString()} already stored · calls from {preview.from ?? "—"} to {preview.to ?? "—"}</p>

          <h4>Dispositions</h4>
          <p className="na">Choose which of our dispositions each of the app&rsquo;s counts as. Several of the app&rsquo;s can count as one of ours, and one can count as none. What you choose is remembered for the next upload.</p>
          <Table head={["App disposition", "Calls", "Counts as"]} empty="The sheet has no dispositions." rows={preview.dispositions.map((d) => [
            <span key="v" className="mono">{d.value}</span>, d.count.toLocaleString(),
            <select key="s" aria-label={`Disposition for ${d.value}`} value={map[d.value] ?? ""} onChange={(e) => setMap({ ...map, [d.value]: e.target.value })}>
              <option value="">None (no disposition)</option>
              {OURS.map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}
            </select>,
          ])} />

          <h4>Members</h4>
          <Table head={["Member", "Calls", "Representative"]} empty="No members." rows={preview.members.map((m) => [m.name, m.calls.toLocaleString(), m.representative ?? "not linked yet"])} />

          <div className="adm-actions">
            <button className="btn primary" disabled={!preview.willCommit || act.busy} onClick={commit}>{act.busy ? "Saving… this can take a minute" : "Save this upload"}</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
