"use client";

import { useState } from "react";
import { colorOf, fShort, n0 } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { ClientTable, Overview } from "@/lib/types";
import CallsTable from "./CallsTable";
import ProfileDrawer from "./ProfileDrawer";
import RevenuePanel from "./RevenuePanel";
import { Async, Dot } from "./ui";

/** Emails sent, opened and replied per client for the selected dates (the same counts as the Overview). */
function EmailsPanel() {
  const { qs } = useFilters();
  const state = useApi<Overview>(`/overview?${qs}`);
  return (
    <section className="panel" id="em-client">
      <header><h3>Emails</h3></header>
      <Async state={state}>
        {(o) => {
          const rows = o.byClient.filter((x) => x.emailsSent);
          if (!rows.length) return <div className="empty">No emails in the selected dates.</div>;
          return (
            <div className="tablewrap">
              <table>
                <thead><tr><th className="left">Client</th><th>Emails sent</th><th>Opened</th><th>Replied</th></tr></thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.clientId}>
                      <td className="name"><Dot color={colorOf(x.name)} />{x.name}</td>
                      <td>{n0(x.emailsSent)}</td><td>{n0(x.opened)}</td><td>{n0(x.replied)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td className="name">Total</td><td>{n0(o.emails.sent)}</td><td>{n0(o.emails.opened)}</td><td>{n0(o.emails.replied)}</td></tr></tfoot>
              </table>
            </div>
          );
        }}
      </Async>
    </section>
  );
}

export default function ClientView() {
  const { qs, from, to, meta } = useFilters();
  const state = useApi<ClientTable>(`/clients/table?${qs}`);
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);

  return (
    <section className="view" id="view-client">
      <Async state={state}>
        {(t) => {
          if (!t.clients.length) return <><div className="opsbar" /><div className="empty">No calls in the selected dates. Widen the date range above.</div></>;
          return (
            <>
              <div className="opsbar">{fShort(from)} – {fShort(to)} · {t.weeks} week{t.weeks === 1 ? "" : "s"} of calls</div>
              <section className="panel">
                <header><h3>Calls by Client and Sales Representative</h3></header>
                <CallsTable nodes={t.clients} total={t.total} first="client" meaningfulSeconds={meta.meaningfulSeconds} onOpen={(id) => setOpen({ id, name: t.clients.find((c) => c.id === id)?.name ?? "" })} />
              </section>
              <RevenuePanel by="client" />
              <EmailsPanel />
            </>
          );
        }}
      </Async>
      {open && <ProfileDrawer kind="client" id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </section>
  );
}
