"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import { Card, DayBars, Kpi, Pager, RankBars, Table, inputCls } from "@/components/ui";
import { qs } from "@/lib/api";
import { dateTime, duration, num, pct } from "@/lib/format";
import { useApi, useMe } from "@/lib/hooks";
import type { CallItem, EmailItem, Filters, Paged, Stats, Workbook } from "@/lib/types";

const RANGES = [7, 30, 90, 365];
type Tab = "calls" | "emails" | "sheets";

export default function Dashboard() {
  const me = useMe();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<Tab>("calls");
  const { data: s, error, loading } = useApi<Stats>(`/stats${qs({ days })}`);

  return (
    <>
      <Nav me={me} />
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Overview</h1>
          <select aria-label="Date range" value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls}>
            {RANGES.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          {s?.sync.last && (
            <span className={`ml-auto text-xs ${s.sync.last.ok ? "text-ink-3" : "text-bad"}`}>
              {s.sync.last.ok ? `Data synced ${dateTime(s.sync.last.finishedAt)} UTC` : `Last sync failed: ${s.sync.last.error}`}
            </span>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {loading && !s && <p className="text-sm text-ink-3">Loading…</p>}

        {s && (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi accent="calls" label="Calls" value={num(s.calls.total)} sub={`${num(s.calls.connected)} connected (${pct(s.calls.connected, s.calls.total)})`} />
              <Kpi accent="calls" label="Avg talk time" value={duration(s.calls.avgDurationSec)} sub={`${duration(s.calls.totalSeconds)} total`} />
              <Kpi accent="emails" label="Emails sent" value={num(s.emails.sent)} sub={`${num(s.emails.bounced)} bounced (${pct(s.emails.bounced, s.emails.sent)})`} />
              <Kpi accent="emails" label="Open / reply rate" value={`${pct(s.emails.opened, s.emails.sent)} / ${pct(s.emails.replied, s.emails.sent)}`} sub={`${num(s.emails.opened)} opened · ${num(s.emails.replied)} replied`} />
            </section>

            <section className="mt-6 grid gap-4 lg:grid-cols-2">
              <Card title="Calls per day"><DayBars data={s.calls.byDay} color="var(--calls)" unit="calls" /></Card>
              <Card title="Emails sent per day"><DayBars data={s.emails.byDay} color="var(--emails)" unit="emails" /></Card>
              <Card title="Calls by agent" note="top 15">
                <RankBars data={s.calls.byAgent.map((a) => ({ name: a.agent, value: a.count }))} color="var(--calls)" unit="calls" />
              </Card>
              <Card title="Email sequences" note="top 15 by volume">
                <div className="max-h-96 overflow-y-auto">
                  <Table
                    head={["Sequence", "Sent", "Open", "Reply", "Bounce"]}
                    rows={s.emails.bySequence.map((q) => [
                      <span key="n" className="block max-w-[16rem] truncate" title={q.sequence}>{q.sequence}</span>,
                      num(q.sent), pct(q.opened, q.sent), pct(q.replied, q.sent), pct(q.bounced, q.sent),
                    ])}
                    empty="No emails in this range."
                  />
                </div>
              </Card>
            </section>
          </div>
        )}

        <div role="tablist" className="flex gap-1 border-b border-line">
          {([["calls", "Calls"], ["emails", "Emails"], ["sheets", "Spreadsheets"]] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === k ? "border-ink font-semibold" : "border-transparent text-ink-2"}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === "calls" && <CallsTable />}
        {tab === "emails" && <EmailsTable />}
        {tab === "sheets" && <Sheets />}
      </main>
    </>
  );
}

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function CallsTable() {
  const [page, setPage] = useState(1);
  const [agent, setAgent] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data: f } = useApi<Filters>("/stats/filters");
  const { data, error, loading } = useApi<Paged<CallItem>>(`/calls${qs({ page, agent, q: dq })}`);

  return (
    <Card title="Call log">
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Agent" value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1); }} className={inputCls}>
          <option value="">All agents</option>
          {f?.agents.map((a) => <option key={a}>{a}</option>)}
        </select>
        <input aria-label="Search calls" placeholder="Search number or agent" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className={inputCls} />
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className={loading ? "opacity-60" : ""}>
        <Table
          head={["When (UTC)", "Agent", "Line", "Contact", "Duration", "Disposition", "Recording"]}
          rows={(data?.items ?? []).map((c) => [
            dateTime(c.startedAt), c.agentName ?? "–", c.justcallNoName ?? "–", c.contactNo ?? "–", duration(c.duration), c.disposition ?? "–",
            c.recordingUrl ? <a key="r" href={c.recordingUrl} target="_blank" rel="noreferrer noopener" className="underline">Listen</a> : "–",
          ])}
        />
      </div>
      {data && <Pager page={page} perPage={data.perPage} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function EmailsTable() {
  const [page, setPage] = useState(1);
  const [sequence, setSequence] = useState("");
  const [stage, setStage] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data: f } = useApi<Filters>("/stats/filters");
  const { data, error, loading } = useApi<Paged<EmailItem>>(`/emails${qs({ page, sequence, stage, status, q: dq })}`);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <Card title="Email log">
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Sequence" value={sequence} onChange={(e) => reset(setSequence)(e.target.value)} className={`${inputCls} max-w-[18rem]`}>
          <option value="">All sequences</option>
          {f?.sequences.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select aria-label="Contact stage" value={stage} onChange={(e) => reset(setStage)(e.target.value)} className={inputCls}>
          <option value="">All stages</option>
          {f?.stages.map((a) => <option key={a}>{a}</option>)}
        </select>
        <select aria-label="Outcome" value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={inputCls}>
          <option value="">Any outcome</option>
          {["opened", "clicked", "replied", "bounced"].map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
        </select>
        <input aria-label="Search emails" placeholder="Search subject, email, company" value={q} onChange={(e) => reset(setQ)(e.target.value)} className={inputCls} />
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className={loading ? "opacity-60" : ""}>
        <Table
          head={["Sent (UTC)", "To", "Company", "Subject", "Step", "Stage", "Outcome"]}
          rows={(data?.items ?? []).map((m) => [
            dateTime(m.sentAt), m.toName ? `${m.toName} <${m.toEmail}>` : (m.toEmail ?? "–"), m.toCompany ?? "–",
            <span key="s" className="block max-w-[18rem] truncate" title={m.subject ?? ""}>{m.subject ?? "–"}</span>,
            m.step ?? "–", m.contactStage ?? "–",
            [m.replied && "Replied", m.click && "Clicked", m.open && "Opened", m.bounce && "Bounced", m.unsubscribe && "Unsubscribed"].filter(Boolean).join(", ") || "–",
          ])}
        />
      </div>
      {data && <Pager page={page} perPage={data.perPage} total={data.total} onPage={setPage} />}
    </Card>
  );
}

function Sheets() {
  const { data, error, loading } = useApi<Workbook[]>("/sheets");
  if (loading) return <p className="text-sm text-ink-3">Loading…</p>;
  if (error) return <p role="alert" className="text-sm text-bad">{error}</p>;
  if (!data?.length) return <p className="text-sm text-ink-3">No .xlsx files in the current build. An admin can upload one.</p>;
  return (
    <div className="space-y-4">
      {data.map((b) =>
        b.error ? (
          <p key={b.file} role="alert" className="text-sm text-bad">{b.file}: {b.error}</p>
        ) : (
          b.sheets.map((sh) => (
            <Card key={`${b.file}/${sh.name}`} title={`${b.file} · ${sh.name}`}
              note={sh.totalRows > sh.rows.length ? `Showing ${sh.rows.length} of ${sh.totalRows} rows` : `${sh.totalRows} rows`}>
              <div className="max-h-96 overflow-auto">
                <Table head={sh.header} rows={sh.rows} />
              </div>
            </Card>
          ))
        ),
      )}
    </div>
  );
}
