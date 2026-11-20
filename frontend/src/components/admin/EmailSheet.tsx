"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, Pill, Table, useAction, when } from "./parts";

type Preview = {
  stagedId: string; fileName: string; rows: number; newEmails: number; existing: number; from: string | null; to: string | null;
  sent: number; opened: number; replied: number; bounced: number;
  heading: string | null; zone: string; zoneFound: string | null;
  firstTimes: { sheet: string; utc: string; database: string }[];
  clients: { id: number; name: string }[]; clientId: number | null;
  errors: string[]; warnings: string[]; willCommit: boolean;
};
type Upload = { id: number; fileName: string | null; uploadedBy: string | null; uploadedAt: string; client: string | null; rows: number; emailsNow: number; dateFrom: string | null; dateTo: string | null; status: string };

const ZONES: [string, string][] = [["pacific", "Pacific"], ["eastern", "Eastern"], ["central", "Central"], ["mountain", "Mountain"], ["utc", "UTC"], ["ist", "IST"]];

/** A client's email sheet (for example GTK's), added to the same emails as the rest. The email text is not taken. */
export default function EmailSheet() {
  const [tick, setTick] = useState(0);
  const history = useApi<Upload[]>(`/admin/files/email-sheet/uploads?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [clientId, setClientId] = useState("");
  const [zone, setZone] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check(c = clientId, z = zone) {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    if (c) f.set("clientId", c);
    if (z) f.set("zone", z);
    const p = await act.run(() => api<Preview>("/admin/files/email-sheet/preview", { method: "POST", body: f }));
    if (!p) return;
    setPreview(p);
    setClientId(p.clientId ? String(p.clientId) : "");
    setZone(p.zone);
  }
  async function commit() {
    if (!preview || !clientId) return;
    const r = await act.run(() => api<{ committed: boolean; inserted: number; updated: number; unchanged: number }>("/admin/files/email-sheet/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName, clientId: Number(clientId), zone }),
    }));
    if (!r) return;
    setDone(`Saved. ${r.inserted.toLocaleString()} new email${r.inserted === 1 ? "" : "s"}, ${r.updated.toLocaleString()} updated, ${r.unchanged.toLocaleString()} unchanged. The dashboards are updated.`);
    setPreview(null); setFile(null); setClientId(""); setZone(""); setTick((t) => t + 1);
  }
  async function remove(id: number) {
    const r = await act.run(() => api<{ deleted: number }>(`/admin/files/email-sheet/uploads/${id}/delete`, { method: "POST" }));
    if (r) { setDone(`Deleted. ${r.deleted.toLocaleString()} email${r.deleted === 1 ? "" : "s"} removed.`); setTick((t) => t + 1); }
  }

  return (
    <section className="panel">
      <header><h3>Email sheet (for example GTK)</h3></header>
      <p className="na">
        Upload a client&rsquo;s downloaded email sheet. The header row is found by its column names. Only the same details we get from the database are taken (sender, recipient, sequence, step, subject, sent time, and sent / opened / replied / bounced and so on). The email text (Body HTML and reply message) is not taken.
        An email is saved once, so a bigger sheet that repeats earlier emails only adds the new ones. The emails then show wherever the client&rsquo;s emails are shown.
      </p>
      <div className="adm-form">
        <FilePick accept=".xlsx,.xlsm,.csv" label="Email sheet" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); setClientId(""); setZone(""); }} />
        <button className="btn primary" disabled={!file || act.busy} onClick={() => check()}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
      </div>
      <ErrorBox error={act.error} problems={act.problems} />
      {done && <Notice kind="ok">{done}</Notice>}

      {preview && (
        <div className="adm-preview">
          <h4>{preview.fileName} · {preview.rows.toLocaleString()} emails</h4>
          {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          {preview.warnings.length > 0 && <Notice kind="warn"><ul>{preview.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
          <div className="adm-form">
            <label>Client
              <select aria-label="Client for these emails" value={clientId} onChange={(e) => { setClientId(e.target.value); check(e.target.value, zone); }}>
                <option value="">Choose a client…</option>
                {preview.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>The sheet&rsquo;s times are in
              <select aria-label="Time zone of the sheet" value={zone} onChange={(e) => { setZone(e.target.value); check(clientId, e.target.value); }}>
                {ZONES.map(([k, v]) => <option key={k} value={k}>{v} time</option>)}
              </select>
            </label>
          </div>
          <p className="na">
            {preview.zoneFound ? `The heading “${preview.heading}” says ${preview.zoneFound === preview.zone ? preview.zone : preview.zoneFound} time.` : `The heading “${preview.heading ?? ""}” names no time zone.`}
            {" "}The sheet&rsquo;s times are converted to the time the database keeps; the database&rsquo;s own times are never changed. Compare the first emails below with the same emails in the database; if they differ, change the time zone above.
          </p>
          <Table head={["Sent At in the sheet", "As the database keeps it (UTC)", "Database date and time (Pacific)"]} empty="No sent times." rows={preview.firstTimes.map((t) => [t.sheet, t.utc, t.database])} />
          <p className="small"><b>{preview.newEmails.toLocaleString()}</b> new · {preview.existing.toLocaleString()} already stored · sent {preview.from ?? "—"} to {preview.to ?? "—"} · {preview.sent.toLocaleString()} sent · {preview.opened.toLocaleString()} opened · {preview.replied.toLocaleString()} replied · {preview.bounced.toLocaleString()} bounced</p>
          <div className="adm-actions">
            <button className="btn primary" disabled={!preview.willCommit || !clientId || act.busy} onClick={commit}>{act.busy ? "Saving…" : "Save this upload"}</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      <h4>Uploads</h4>
      <p className="na">Deleting an upload removes the emails that file added.</p>
      <Async state={history}>
        {(list) => (
          <Table head={["#", "When", "File", "Client", "By", "Emails", "Sent", "Status", ""]} empty="No uploads yet." rows={list.map((u) => [
            u.id, when(u.uploadedAt), u.fileName ?? "—", u.client ?? "—", u.uploadedBy ?? "—", u.emailsNow.toLocaleString(), u.dateFrom ? `${u.dateFrom} to ${u.dateTo}` : "—", <Pill key="s" status={u.status} />,
            u.status !== "deleted" ? <button key="d" className="btn small" disabled={act.busy} onClick={() => confirm(`Delete this upload? Its ${u.emailsNow.toLocaleString()} emails will be removed.`) && remove(u.id)}>Delete</button> : "",
          ])} />
        )}
      </Async>
    </section>
  );
}
