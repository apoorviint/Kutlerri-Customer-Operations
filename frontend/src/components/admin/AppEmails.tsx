"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, FilePick, Notice, Pill, Table, useAction, when } from "./parts";

type Preview = {
  stagedId: string; fileName: string; rows: number; newEmails: number; existing: number; from: string | null; to: string | null;
  sent: number; opened: number; replied: number; bounced: number;
  byClient: { name: string; emails: number }[];
  firstTimes: { sheet: string; utc: string; database: string }[];
  errors: string[]; warnings: string[]; willCommit: boolean;
};
type Upload = { id: number; fileName: string | null; uploadedBy: string | null; uploadedAt: string; client: string | null; rows: number; emailsNow: number; dateFrom: string | null; dateTo: string | null; status: string };

/** The app's email export. Each row's Tenant is its client; the emails then show wherever a client's emails are shown. */
export default function AppEmails() {
  const [tick, setTick] = useState(0);
  const history = useApi<Upload[]>(`/admin/files/email-sheet/uploads?x=${tick}`);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();

  async function check() {
    if (!file) return;
    setDone(null);
    const f = new FormData();
    f.set("file", file);
    const p = await act.run(() => api<Preview>("/admin/files/app-emails/preview", { method: "POST", body: f }));
    if (p) setPreview(p);
  }
  async function commit() {
    if (!preview) return;
    const r = await act.run(() => api<{ committed: boolean; inserted: number; updated: number; unchanged: number }>("/admin/files/app-emails/commit", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stagedId: preview.stagedId, fileName: preview.fileName }),
    }));
    if (!r) return;
    setDone(`Saved. ${r.inserted.toLocaleString()} new email${r.inserted === 1 ? "" : "s"}, ${r.updated.toLocaleString()} updated, ${r.unchanged.toLocaleString()} unchanged. The dashboards are updated.`);
    setPreview(null); setFile(null); setTick((t) => t + 1);
  }
  async function remove(id: number) {
    const r = await act.run(() => api<{ deleted: number }>(`/admin/files/email-sheet/uploads/${id}/delete`, { method: "POST" }));
    if (r) { setDone(`Deleted. ${r.deleted.toLocaleString()} email${r.deleted === 1 ? "" : "s"} removed.`); setTick((t) => t + 1); }
  }

  return (
    <section className="panel">
      <header><h3>App emails</h3></header>
      <p className="na">
        Upload the app&rsquo;s email export. The header row is found by its column names. The Tenant (for example RASA) is the client of each email, and the Sent time is read as New York time.
        An email is saved once (by its Message id), so a bigger file that repeats earlier emails only adds the new ones. The email text (Reply text) is not taken. The emails then show wherever the client&rsquo;s emails are shown.
      </p>
      <div className="adm-form">
        <FilePick accept=".xlsx,.xlsm,.csv" label="App emails file" file={file} onFile={(f) => { setFile(f); setPreview(null); setDone(null); }} />
        <button className="btn primary" disabled={!file || act.busy} onClick={check}>{act.busy && !preview ? "Checking…" : "Check the file"}</button>
      </div>
      <ErrorBox error={act.error} problems={act.problems} />
      {done && <Notice kind="ok">{done}</Notice>}

      {preview && (
        <div className="adm-preview">
          <h4>{preview.fileName} · {preview.rows.toLocaleString()} emails</h4>
          {preview.errors.length > 0 && <Notice kind="bad"><b>These must be fixed before saving:</b><ul>{preview.errors.slice(0, 40).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
          {preview.warnings.length > 0 && <Notice kind="warn"><ul>{preview.warnings.slice(0, 20).map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
          <p className="na">The sheet&rsquo;s times are converted to the time the database keeps. Compare the first emails below with the same emails in the database if you want to be sure.</p>
          <Table head={["Sent in the sheet (New York)", "As the database keeps it (UTC)", "Database date and time (Pacific)"]} empty="No sent times." rows={preview.firstTimes.map((t) => [t.sheet, t.utc, t.database])} />
          <p className="small">{preview.byClient.map((c) => `${c.name} ${c.emails.toLocaleString()}`).join(" · ")}</p>
          <p className="small"><b>{preview.newEmails.toLocaleString()}</b> new · {preview.existing.toLocaleString()} already stored · sent {preview.from ?? "—"} to {preview.to ?? "—"} · {preview.sent.toLocaleString()} sent · {preview.opened.toLocaleString()} opened · {preview.replied.toLocaleString()} replied · {preview.bounced.toLocaleString()} bounced</p>
          <div className="adm-actions">
            <button className="btn primary" disabled={!preview.willCommit || act.busy} onClick={commit}>{act.busy ? "Saving…" : "Save this upload"}</button>
            <button className="btn" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      <h4>Uploads</h4>
      <p className="na">Email sheet uploads and app email uploads are listed together. Deleting an upload removes the emails that file added.</p>
      <Async state={history}>
        {(list) => (
          <Table head={["#", "When", "File", "Client", "By", "Emails", "Sent", "Status", ""]} empty="No uploads yet." rows={list.map((u) => [
            u.id, when(u.uploadedAt), u.fileName ?? "—", u.client ?? "Several", u.uploadedBy ?? "—", u.emailsNow.toLocaleString(), u.dateFrom ? `${u.dateFrom} to ${u.dateTo}` : "—", <Pill key="s" status={u.status} />,
            u.status !== "deleted" ? <button key="d" className="btn small" disabled={act.busy} onClick={() => confirm(`Delete this upload? Its ${u.emailsNow.toLocaleString()} emails will be removed.`) && remove(u.id)}>Delete</button> : "",
          ])} />
        )}
      </Async>
    </section>
  );
}
