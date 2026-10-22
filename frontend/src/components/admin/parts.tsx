"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api";

/** Small pieces every admin screen uses. */

export const phone = (p: string | null) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : (p ?? "(no line)"));
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");
export const n = (v: number) => v.toLocaleString();

export function Notice({ kind, children }: { kind: "bad" | "warn" | "ok" | "info"; children: React.ReactNode }) {
  return <div className={`note-box ${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
}

export function Section({ title, count, children, open }: { title: string; count?: number; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="panel adm-sec" open={open}>
      <summary><h3>{title}</h3>{count !== undefined && <span className={`cl-count ${count ? "warn" : ""}`}>{n(count)}</span>}</summary>
      <div className="adm-body">{children}</div>
    </details>
  );
}

export function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="na">{empty ?? "Nothing to show."}</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Pill({ status }: { status: string }) {
  const map: Record<string, string> = { committed: "ok", processing: "info", failed: "bad", rolled_back: "na" };
  return <span className={`pill ${map[status] ?? "na"}`}>{status.replace("_", " ")}</span>;
}

/** Runs an async action and keeps its busy and error state, so a button cannot be pressed twice. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null); setProblems([]);
    try { return await fn(); }
    catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      const p = e instanceof ApiError ? (e.body?.problems as string[] | undefined) : undefined;
      if (p) setProblems(p);
      return undefined;
    } finally { setBusy(false); }
  }
  return { busy, error, problems, run, clear: () => { setError(null); setProblems([]); } };
}

export function ErrorBox({ error, problems }: { error: string | null; problems?: string[] }) {
  if (!error) return null;
  return (
    <Notice kind="bad">
      {error}
      {problems && problems.length > 0 && <ul>{problems.slice(0, 30).map((p, i) => <li key={i}>{p}</li>)}{problems.length > 30 && <li>…and {problems.length - 30} more</li>}</ul>}
    </Notice>
  );
}

/** A file chooser that keeps the chosen file and clears itself after a successful upload. */
export function FilePick({ accept, label, file, onFile }: { accept: string; label: string; file: File | null; onFile: (f: File | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="filepick">
      <input ref={ref} type="file" accept={accept} aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && <button type="button" className="link" onClick={() => { onFile(null); if (ref.current) ref.current.value = ""; }}>Clear</button>}
    </div>
  );
}

export const TemplateLink = ({ name, label }: { name: string; label: string }) => (
  <a className="link" href={`/api/admin/templates/${name}`} download>{label}</a>
);
