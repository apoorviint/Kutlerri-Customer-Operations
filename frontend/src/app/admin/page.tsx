"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "@/components/Nav";
import { Card, Table } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useMe } from "@/lib/hooks";

type RepoFile = { name: string; size: number; htmlUrl: string | null; live: boolean };
type SyncStatus = { running: boolean; last: { ok: boolean; finishedAt: string | null; error: string | null; calls: number; emails: number; full: boolean } | null };

export default function AdminPage() {
  const me = useMe();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<RepoFile[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (me && me.role !== "ADMIN") router.replace("/dashboard");
  }, [me, router]);

  const loadFiles = useCallback(() => {
    api<RepoFile[]>("/admin/files").then((f) => { setFiles(f); setFilesError(null); }).catch((e: Error) => setFilesError(e.message));
  }, []);
  const loadSync = useCallback(() => api<SyncStatus>("/sync/status").then(setSync).catch(() => {}), []);

  useEffect(() => { loadFiles(); loadSync(); }, [loadFiles, loadSync]);

  // while a sync runs, poll its status
  useEffect(() => {
    if (!sync?.running) return;
    const t = setInterval(loadSync, 3000);
    return () => clearInterval(t);
  }, [sync?.running, loadSync]);

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setMsg(null);
    try {
      return await fn();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const out = await run(() => api<{ name: string }>("/admin/upload", { method: "POST", body: fd }));
    if (out) {
      setMsg({ ok: true, text: `Pushed ${out.name} to GitHub. The dashboard shows it once the new build is deployed.` });
      if (input.current) input.current.value = "";
      loadFiles();
    }
  }

  async function remove(name: string) {
    setConfirm("");
    const out = await run(() => api(`/admin/files/${encodeURIComponent(name)}`, { method: "DELETE" }));
    if (out) {
      setMsg({ ok: true, text: `Removed ${name} from GitHub. The dashboard drops it after the next build.` });
      loadFiles();
    }
  }

  async function startSync() {
    const out = await run(() => api("/sync", { method: "POST" }));
    if (out) {
      setSync((s) => ({ running: true, last: s?.last ?? null }));
      setTimeout(loadSync, 1500);
    }
  }

  return (
    <>
      <Nav me={me} />
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <h1 className="text-xl font-semibold">Admin</h1>

        <Card title="Spreadsheets" note="Uploads are committed to GitHub; your host rebuilds and the dashboard updates">
          <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
            <input ref={input} type="file" required accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.txt,.json,.doc,.docx" className="text-sm" />
            <button disabled={busy} className="rounded-md bg-ink px-4 py-2 text-sm text-surface disabled:opacity-60">Upload &amp; push to GitHub</button>
          </form>
          <p className="mt-2 text-xs text-ink-3">Only .xlsx files are displayed on the dashboard. Max 10 MB. Re-uploading a name replaces that file.</p>
          {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
        </Card>

        <Card title="Files in the repo">
          {filesError && <p role="alert" className="text-sm text-bad">{filesError}</p>}
          <Table
            head={["File", "Size", "Dashboard", ""]}
            rows={(files ?? []).map((f) => [
              f.htmlUrl ? <a key="n" href={f.htmlUrl} target="_blank" rel="noreferrer noopener" className="underline">{f.name}</a> : f.name,
              `${(f.size / 1024).toFixed(1)} KB`,
              f.live ? "Live" : "Waiting for build…",
              confirm === f.name ? (
                <span key="c" className="flex gap-3">
                  <button disabled={busy} onClick={() => remove(f.name)} className="text-bad underline">Confirm delete</button>
                  <button onClick={() => setConfirm("")} className="underline">Cancel</button>
                </span>
              ) : (
                <button key="d" onClick={() => setConfirm(f.name)} className="text-ink-2 underline">Delete</button>
              ),
            ])}
            empty={files ? "No files yet." : "Loading…"}
          />
        </Card>

        <Card title="Calls &amp; emails sync" note="Pulls new data from the call-logs API into the database">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={startSync} disabled={busy || sync?.running} className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-60">
              {sync?.running ? "Syncing…" : "Sync now"}
            </button>
            {sync?.last && (
              <span className={`text-sm ${sync.last.ok ? "text-ink-2" : "text-bad"}`}>
                {sync.last.ok
                  ? `Last ${sync.last.full ? "full " : ""}sync ${dateTime(sync.last.finishedAt)} UTC: ${sync.last.calls.toLocaleString()} calls, ${sync.last.emails.toLocaleString()} emails`
                  : `Last sync failed: ${sync.last.error}`}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-3">The first sync loads the full history and can take a few minutes. Later syncs only fetch recent days.</p>
        </Card>
      </main>
    </>
  );
}
