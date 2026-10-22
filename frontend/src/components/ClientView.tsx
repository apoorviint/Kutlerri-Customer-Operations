"use client";

import { useState } from "react";
import { fShort } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { ClientTable } from "@/lib/types";
import CallsTable from "./CallsTable";
import ProfileDrawer from "./ProfileDrawer";
import RevenuePanel from "./RevenuePanel";
import { Async } from "./ui";

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
            </>
          );
        }}
      </Async>
      {open && <ProfileDrawer kind="client" id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </section>
  );
}
