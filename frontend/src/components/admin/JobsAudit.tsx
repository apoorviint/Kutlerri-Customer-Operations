"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ErrorBox, Notice, Table, useAction, when } from "./parts";

type Run = {
  id: string; source: string; kind: string; status: string; startedAt: string; fetched: number; inserted: number; updated: number;
  error: string | null; triggeredBy: string | null; windowFrom: string | null; windowTo: string | null;
  details: { daysDone?: number; daysTotal?: number; catchUp?: { stored: number; api: number } } | null;
};

const JOBS: [string, string][] = [
  ["calls", "Calls (read from the call-logs API)"],
  ["emails", "Emails (read from the call-logs API)"],
  ["attribute-calls", "Work out who each call belongs to"],
  ["rebuild-rollups", "Rebuild the daily numbers"],
  ["recompute-call-times", "Re-apply time zone rules to stored calls"],
  ["recompute-email-clients", "Re-match emails to clients"],
];

export function Jobs() {
  const [tick, setTick] = useState(0);
  const runs = useApi<Run[]>(`/jobs/runs?x=${tick}`);
  const [job, setJob] = useState("calls");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const act = useAction();

  async function start() {
    setMsg(null);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const q = qs.toString();
    const r = await act.run(() => api<{ started: boolean }>(`/jobs/${job}/run${q ? `?${q}` : ""}`, { method: "POST" }));
    if (r) {
      setMsg("Started. It runs in the background; refresh the list to follow it.");
      setTimeout(() => setTick((t) => t + 1), 1500);
    }
  }

  return (
    <>
      <section className="panel">
        <header><h3>Run a job again</h3></header>
        <p className="na">Choose a job and, if you like, a range of dates. Dates are the provider&apos;s dates for calls and emails, and shift days for the others. Leave both empty for the normal run.</p>
        <div className="adm-form">
          <label>Job<select aria-label="Job to run" value={job} onChange={(e) => setJob(e.target.value)}>{JOBS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>From<input aria-label="From date" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input aria-label="To date" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn primary" disabled={act.busy} onClick={start}>{act.busy ? "Starting…" : "Run"}</button>
        </div>
        <ErrorBox error={act.error} />
        {msg && <Notice kind="ok">{msg}</Notice>}
      </section>
      <section className="panel">
        <header className="adm-row"><h3>Recent runs</h3><button className="btn" onClick={() => setTick((t) => t + 1)}>Refresh</button></header>
        <Async state={runs}>
          {(list) => (
            <Table head={["Started", "Job", "Kind", "Status", "Rows", "Window", "By", "Notes"]} empty="No runs yet."
              rows={list.map((r) => [
                when(r.startedAt), r.source, r.kind,
                <span key="s" className={`pill ${r.status === "ok" ? "ok" : r.status === "running" ? "info" : r.status === "warning" ? "warn" : "bad"}`}>{r.status}</span>,
                `${r.fetched.toLocaleString()} read · ${r.inserted} new · ${r.updated} changed`,
                r.windowFrom ? `${r.windowFrom.slice(0, 10)} → ${r.windowTo?.slice(0, 10) ?? "…"}` : "—",
                r.triggeredBy ?? "—",
                <span key="n" className="small">
                  {r.status === "running" && r.details?.daysTotal ? `day ${r.details.daysDone ?? 0} of ${r.details.daysTotal}`
                    : r.details?.catchUp ? `caught up: the API had ${r.details.catchUp.api}, we had ${r.details.catchUp.stored}`
                    : (r.error ?? "").slice(0, 160)}
                </span>,
              ])} />
          )}
        </Async>
      </section>
    </>
  );
}

type Row = { id: number; at: string; actor: string; action: string; target: string | null; details: unknown };
const short = (d: unknown) => {
  if (d == null) return "";
  const s = JSON.stringify(d);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};

export function Audit() {
  const state = useApi<Row[]>("/admin/audit?limit=200");
  return (
    <section className="panel">
      <header><h3>Audit log</h3></header>
      <p className="na">Every upload, rollback, job re-run and change to a setting or mapping: who did it and when.</p>
      <Async state={state}>
        {(rows) => (
          <Table head={["When", "Who", "What", "Target", "Details"]} empty="Nothing recorded yet."
            rows={rows.map((r) => [when(r.at), r.actor, r.action, r.target ?? "—", <span key="d" className="small mono">{short(r.details)}</span>])} />
        )}
      </Async>
    </section>
  );
}
