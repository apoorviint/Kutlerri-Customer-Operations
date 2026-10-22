"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminPanel({ files }: { files: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      return json;
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
    const out = await call("/api/admin/upload", { method: "POST", body: fd });
    if (out) {
      setMsg({ ok: true, text: `Pushed ${out.name} to GitHub. The dashboard updates after the build finishes.` });
      if (input.current) input.current.value = "";
      router.refresh();
    }
  }

  async function remove(name: string) {
    const out = await call(`/api/admin/files?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    setConfirmDelete("");
    if (out) {
      setMsg({ ok: true, text: `Removed ${name} from GitHub. The dashboard updates after the build.` });
      router.refresh();
    }
  }

  async function sync() {
    const out = await call("/api/sync", { method: "POST" });
    if (out) {
      setMsg({ ok: true, text: `Synced ${out.calls} calls and ${out.mails} mails` });
      router.refresh();
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-4">
      <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" required className="text-sm" />
        <button disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60">
          Upload &amp; push to GitHub
        </button>
      </form>
      {files.length > 0 && (
        <ul className="space-y-1 text-sm">
          {files.map((n) => (
            <li key={n} className="flex items-center gap-3">
              <span>{n}</span>
              {confirmDelete === n ? (
                <>
                  <button disabled={busy} onClick={() => remove(n)} className="text-red-600 underline">Confirm delete</button>
                  <button onClick={() => setConfirmDelete("")} className="underline">Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDelete(n)} className="text-slate-500 underline">Delete</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button onClick={sync} disabled={busy} className="rounded-md border px-4 py-2 text-sm disabled:opacity-60">
        Sync from API now
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}
