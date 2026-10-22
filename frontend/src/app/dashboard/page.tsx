"use client";

import Nav from "@/components/Nav";
import { Card, Stat } from "@/components/ui";
import { useApi, useMe } from "@/lib/hooks";

type Run = { status: string; kind: string; fetched: number; inserted: number; updated: number; unchanged: number; skipped: number; finishedAt: string | null; error: string | null };
type Status = {
  showingFrom: string;
  calls: { total: number; newestCallAt: string | null; firstShiftDate: string | null; lastShiftDate: string | null; lastSyncedAt: string | null; lastRun: Run | null };
  emails: { total: number; newestSentAt: string | null; withoutClient: number; internal: number; lastSyncedAt: string | null; lastRun: Run | null };
  timezoneRules: number;
  syncing: boolean;
  warnings: string[];
};

// Times are shown in IST, as the dashboards will.
const ist = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" : "never";
const n = (v: number) => v.toLocaleString();

export default function DataStatus() {
  const me = useMe();
  const { data: s, error, loading } = useApi<Status>("/status");

  return (
    <>
      <Nav me={me} />
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-semibold">Data status</h1>
        <p className="text-sm text-ink-2">
          Phase 1: calls and emails are being collected. The dashboards come next.
          {s && <> Showing data from <b>{s.showingFrom}</b> onwards.</>}
        </p>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {loading && !s && <p className="text-sm text-ink-3">Loading…</p>}
        {s && (
          <>
            {s.warnings.length > 0 && (
              <Card title="Needs attention">
                <ul className="list-disc space-y-1 pl-5 text-sm text-bad">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </Card>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="Calls" note="from JustCall">
                <div className="grid gap-4">
                  <Stat label="Calls stored" value={n(s.calls.total)} sub={s.calls.firstShiftDate ? `Shift days ${s.calls.firstShiftDate} to ${s.calls.lastShiftDate}` : undefined} />
                  <Stat label="Newest call" value={ist(s.calls.newestCallAt)} />
                  <Stat label="Last successful sync" value={ist(s.calls.lastSyncedAt)} sub={s.calls.lastRun ? `Last run: ${s.calls.lastRun.status}` : undefined} />
                </div>
              </Card>
              <Card title="Emails" note="from Apollo">
                <div className="grid gap-4">
                  <Stat label="Emails stored" value={n(s.emails.total)} sub={s.emails.withoutClient ? `${n(s.emails.withoutClient)} not matched to a client` : "All matched to a client"} />
                  <Stat label="Newest email" value={ist(s.emails.newestSentAt)} />
                  <Stat label="Last successful sync" value={ist(s.emails.lastSyncedAt)} sub={s.emails.lastRun ? `Last run: ${s.emails.lastRun.status}` : undefined} />
                </div>
              </Card>
            </div>
            <p className="text-xs text-ink-3">
              {s.syncing ? "A sync is running now. " : ""}
              {s.timezoneRules} agent time-zone correction{s.timezoneRules === 1 ? "" : "s"} in use.
            </p>
          </>
        )}
      </main>
    </>
  );
}
