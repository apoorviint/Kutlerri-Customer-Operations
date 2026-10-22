"use client";

import { useEffect, useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, Pill, Table, TemplateLink, n, useAction, when } from "./parts";

type Mappings = { clients: { id: number; name: string; kind: string }[] };
type Batch = {
  id: number; clientId: number; client: string; fileName: string; uploadedBy: string | null; uploadedAt: string; finishedAt: string | null; status: string; replace: boolean;
  supersededById: number | null; rowsRead: number; phonesIndexed: number; newlyMatched: number; error: string | null;
  progress: { sheet: string | null; rows: number } | null; sheets: { name: string; rows: number; contacts: number; skipped: boolean; reason?: string }[] | null;
};

export default function Prospects() {
  const mappings = useApi<Mappings>("/admin/mappings");
  const [tick, setTick] = useState(0);
  const [clientId, setClientId] = useState<number | null>(null);
  const batches = useApi<Batch[]>(`/admin/files/prospects/batches?x=${tick}${clientId ? `&clientId=${clientId}` : ""}`);
  const totals = useApi<Record<string, number>>(`/admin/files/prospects/summary?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();

  const working = batches.data?.some((b) => b.status === "processing");
  // follow a running upload until it finishes
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [working]);

  const customers = mappings.data?.clients.filter((c) => c.kind === "CUSTOMER") ?? [];
  const clientName = customers.find((c) => c.id === clientId)?.name;

  async function upload() {
    if (!file || !clientId) return;
    setMsg(null);
    const f = new FormData();
    f.set("clientId", String(clientId));
    f.set("replace", String(replace));
    if (replace) f.set("confirmReplace", "true");
    f.set("file", file);
    const r = await act.run(() => api<{ batchId: number }>("/admin/files/prospects/upload", { method: "POST", body: f }));
    if (r) { setMsg("Uploaded. The file is being read in the background; progress shows below."); setFile(null); setReplace(false); setConfirming(false); setTick((x) => x + 1); }
  }
  async function rollback(id: number) {
    const r = await act.run(() => api<{ rolledBack: boolean }>(`/admin/files/prospects/batches/${id}/rollback`, { method: "POST" }));
    if (r) { setMsg(`Upload #${id} rolled back.`); setTick((x) => x + 1); }
  }

  return (
    <>
      <section className="panel">
        <header><h3>Prospect databases</h3></header>
        <p className="na">
          Upload a client&apos;s prospect list (.xlsx or .csv, several sheets are fine, files of 15 MB and more). The columns are found automatically: First and Last Name (or Name), Title, Company, and every column
          with “phone” or “mobile” in its name except head-office (HQ) numbers. Numbers are matched on their last 10 digits, within the same client only. <TemplateLink name="prospects" label="Download an example" />
        </p>
        <div className="adm-form">
          <label>Client
            <select aria-label="Client for this database" value={clientId ?? ""} onChange={(e) => { setClientId(e.target.value ? Number(e.target.value) : null); setConfirming(false); }}>
              <option value="">Choose a client…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <FilePick accept=".xlsx,.xlsm,.csv" label="Prospect database file" file={file} onFile={(f) => { setFile(f); setMsg(null); }} />
        </div>
        <label className="check">
          <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setConfirming(false); }} />
          Replace this client&apos;s databases (default: add to what is already there)
        </label>
        {replace && clientName && <Notice kind="warn">Replacing takes out every database currently loaded for <b>{clientName}</b> and uses only this file. You can roll the upload back to bring them back.</Notice>}
        <div className="adm-actions">
          {!replace || confirming ? (
            <button className="btn primary" disabled={!file || !clientId || act.busy} onClick={upload}>{act.busy ? "Uploading…" : replace ? `Yes, replace and upload` : "Upload"}</button>
          ) : (
            <button className="btn primary" disabled={!file || !clientId} onClick={() => setConfirming(true)}>Upload…</button>
          )}
          {confirming && <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>}
        </div>
        <ErrorBox error={act.error} />
        {msg && <Notice kind="ok">{msg}</Notice>}
      </section>

      <section className="panel">
        <header className="adm-row">
          <h3>Uploads</h3>
          <label className="inl">Show <select aria-label="Show uploads for" value={clientId ?? ""} onChange={(e) => setClientId(e.target.value ? Number(e.target.value) : null)}><option value="">all clients</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </header>
        {totals.data && <p className="small">Phone numbers indexed: {customers.map((c) => `${c.name} ${n(totals.data![String(c.id)] ?? 0)}`).join(" · ")}</p>}
        <Async state={batches}>
          {(list) => (
            <Table head={["#", "Client", "File", "When", "Status", "Rows read", "Phones indexed", "Newly matched calls", "Mode", ""]} empty="No uploads yet."
              rows={list.map((b) => [
                b.id, b.client, b.fileName, when(b.uploadedAt), <Pill key="s" status={b.status} />,
                b.status === "processing" ? `${n(b.progress?.rows ?? b.rowsRead)}…${b.progress?.sheet ? ` (${b.progress.sheet})` : ""}` : n(b.rowsRead),
                b.status === "committed" ? n(b.phonesIndexed) : "—", b.status === "committed" ? n(b.newlyMatched) : "—",
                `${b.replace ? "replace" : "append"}${b.supersededById ? ` · replaced by #${b.supersededById}` : ""}`,
                <div key="a" className="small">
                  {b.status === "failed" && <span className="neg">{b.error}</span>}
                  {b.sheets?.some((s) => s.skipped) && <div>Skipped: {b.sheets.filter((s) => s.skipped).map((s) => s.name).join(", ")} (no usable header)</div>}
                  {b.status === "committed" && !b.supersededById && <button className="btn small" disabled={act.busy} onClick={() => confirm("Roll this upload back?") && rollback(b.id)}>Roll back</button>}
                </div>,
              ])} />
          )}
        </Async>
      </section>
    </>
  );
}
