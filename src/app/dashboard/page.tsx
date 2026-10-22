import Nav from "@/components/Nav";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [total, byStatus, sum, recent, lastSync, files] = await Promise.all([
    db.record.count(),
    db.record.groupBy({ by: ["status"], _count: { _all: true } }),
    db.record.aggregate({ _sum: { value: true } }),
    db.record.findMany({ orderBy: { syncedAt: "desc" }, take: 25 }),
    db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.uploadedFile.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <section className="grid gap-4 sm:grid-cols-3">
          <Card label="Total records" value={total.toLocaleString()} />
          <Card label="Total value" value={(sum._sum.value ?? 0).toLocaleString()} />
          <Card
            label="Last sync"
            value={lastSync ? (lastSync.ok ? lastSync.finishedAt?.toLocaleString() ?? "running…" : "Failed") : "Never"}
            sub={lastSync?.error ?? undefined}
          />
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">By status</h2>
          <ul className="flex flex-wrap gap-2">
            {byStatus.length === 0 && <li className="text-sm text-slate-500">No data yet. An admin can run a sync.</li>}
            {byStatus.map((s) => (
              <li key={s.status ?? "none"} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                {s.status ?? "Unknown"}: <b>{s._count._all}</b>
              </li>
            ))}
          </ul>
        </section>

        <section className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-3">ID</th><th>Title</th><th>Status</th><th>Category</th><th>Value</th><th>Date</th></tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">{r.externalId}</td><td>{r.title}</td><td>{r.status}</td>
                  <td>{r.category}</td><td>{r.value}</td><td>{r.occurredAt?.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold">Files</h2>
          <ul className="space-y-1 text-sm">
            {files.length === 0 && <li className="text-slate-500">No files uploaded.</li>}
            {files.map((f) => (
              <li key={f.id}><a className="underline" href={`/api/files/${f.id}`}>{f.name}</a></li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
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
