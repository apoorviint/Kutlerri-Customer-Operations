import Nav from "@/components/Nav";
import { db } from "@/lib/db";
import { listBuiltFiles } from "@/lib/files";
import { loadWorkbooks } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [calls, mails, callStatus, mailStatus, avgDur, recentCalls, recentMails, lastSync, files, books] =
    await Promise.all([
      db.call.count(),
      db.mail.count(),
      db.call.groupBy({ by: ["status"], _count: { _all: true } }),
      db.mail.groupBy({ by: ["status"], _count: { _all: true } }),
      db.call.aggregate({ _avg: { durationSec: true } }),
      db.call.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
      db.mail.findMany({ orderBy: { sentAt: "desc" }, take: 15 }),
      db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
      listBuiltFiles(),
      loadWorkbooks(),
    ]);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Calls" value={calls.toLocaleString()} />
          <Card label="Avg call duration" value={fmtDur(avgDur._avg.durationSec)} />
          <Card label="Mails" value={mails.toLocaleString()} />
          <Card
            label="Last sync"
            value={lastSync ? (lastSync.ok ? (lastSync.finishedAt?.toLocaleString() ?? "running…") : "Failed") : "Never"}
            sub={lastSync?.error ?? undefined}
          />
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Breakdown title="Calls by status" rows={callStatus} />
          <Breakdown title="Mails by status" rows={mailStatus} />
        </section>

        <Table
          title="Recent calls"
          head={["ID", "Direction", "Agent", "Customer", "Status", "Duration", "Started"]}
          rows={recentCalls.map((c) => [
            c.externalId, c.direction, c.agent, c.customer, c.status, fmtDur(c.durationSec), c.startedAt?.toLocaleString(),
          ])}
        />
        <Table
          title="Recent mails"
          head={["ID", "Subject", "From", "To", "Status", "Sent"]}
          rows={recentMails.map((m) => [m.externalId, m.subject, m.fromAddr, m.toAddr, m.status, m.sentAt?.toLocaleString()])}
        />

        <h2 className="pt-2 text-lg font-semibold">Uploaded spreadsheets</h2>
        {books.length === 0 && (
          <p className="text-sm text-slate-500">No .xlsx files in the current build. An admin can upload one.</p>
        )}
        {books.map((b) =>
          b.error ? (
            <p key={b.file} className="text-sm text-red-600">{b.file}: {b.error}</p>
          ) : (
            b.sheets.map((s) => (
              <Table
                key={`${b.file}/${s.name}`}
                title={`${b.file} · ${s.name}`}
                note={s.totalRows > s.rows.length ? `Showing ${s.rows.length} of ${s.totalRows} rows` : `${s.totalRows} rows`}
                head={s.header}
                rows={s.rows}
              />
            ))
          ),
        )}

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Files in this build</h2>
          <ul className="space-y-1 text-sm">
            {files.length === 0 && <li className="text-slate-500">No files uploaded.</li>}
            {files.map((f) => (
              <li key={f.name}>
                <a className="underline" href={`/api/files/${encodeURIComponent(f.name)}`}>{f.name}</a>
                <span className="ml-2 text-slate-500">{(f.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

function fmtDur(s: number | null | undefined) {
  if (s == null) return "–";
  const t = Math.round(s);
  return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-red-600">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { status: string | null; _count: { _all: number } }[] }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="flex flex-wrap gap-2">
        {rows.length === 0 && <li className="text-sm text-slate-500">No data yet. An admin can run a sync.</li>}
        {rows.map((r) => (
          <li key={r.status ?? "none"} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
            {r.status ?? "Unknown"}: <b>{r._count._all}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Table({ title, note, head, rows }: { title: string; note?: string; head: string[]; rows: (string | null | undefined)[][] }) {
  return (
    <section className="overflow-x-auto rounded-xl border bg-white">
      <div className="flex items-baseline gap-3 p-4 pb-2">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-xs text-slate-500">{note}</span>}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>{head.map((h, i) => <th key={i} className="p-3">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((c, j) => <td key={j} className="p-3">{c ?? ""}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-3 text-slate-500" colSpan={Math.max(head.length, 1)}>No rows.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
