"use client";

import { useState } from "react";
import { fShort, n0, pct } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { RepTable } from "@/lib/types";
import CallsTable from "./CallsTable";
import ProfileDrawer from "./ProfileDrawer";
import RevenuePanel from "./RevenuePanel";
import TimingPanel from "./TimingPanel";
import { Async } from "./ui";

/** "Var%: 12.3% vs prior", in red brackets when it fell. Nothing to compare with shows "n/a". */
function Var({ cur, prev }: { cur: number; prev: number | null | undefined }) {
  if (prev == null) return null;
  if (prev === 0) return <div className="var na">Var%: n/a</div>;
  const d = ((cur - prev) / prev) * 100;
  return <div className={`var ${d < 0 ? "neg" : "pos"}`}>Var%: {d < 0 ? `(${Math.abs(d).toFixed(1)}%)` : `${d.toFixed(1)}%`} vs prior</div>;
}

const Card = ({ k, v, vars, note }: { k: string; v: string; vars?: React.ReactNode; note?: string }) => (
  <div className="card"><div className="k">{k}</div><div className="v">{v}</div>{vars}{note && <div className="note">{note}</div>}</div>
);

export default function RepView() {
  const { qs, from, to, meta } = useFilters();
  const state = useApi<RepTable>(`/reps/table?${qs}`);
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null);

  return (
    <section className="view" id="view-ops">
      <Async state={state}>
        {(t) => {
          if (!t.reps.length) return <><div className="opsbar" /><div className="empty">No calls in the selected dates. Widen the date range above.</div></>;
          const k = t.kpis, c = t.total;
          return (
            <>
              <div className="opsbar">
                {fShort(from)} – {fShort(to)} · {t.weeks} week{t.weeks === 1 ? "" : "s"} of calls
                {k.previous ? " · changes compare with the same number of days before" : " · choose a shorter range to see changes against the days before"}
              </div>
              <div className="cards">
                <Card k="Total dials" v={n0(c.calls)} vars={<Var cur={c.calls} prev={k.previous?.calls} />} />
                <Card k="Connects" v={n0(c.connects)} vars={<Var cur={c.connects} prev={k.previous?.connects} />} note={`${pct(c.connects, c.calls)} of dials`} />
                <Card k="Meaningful conversations" v={n0(c.meaningful)} vars={<Var cur={c.meaningful} prev={k.previous?.meaningful} />}
                  note={`${pct(c.meaningful, c.connects)} of connects · connected, talk time over ${meta.meaningfulSeconds} seconds`} />
              </div>
              <section className="panel">
                <header><h3>Calls by Sales Representative and Client</h3></header>
                <CallsTable nodes={t.reps} total={t.total} first="rep" meaningfulSeconds={meta.meaningfulSeconds} onOpen={(id) => setOpen({ id, name: t.reps.find((r) => r.id === id)?.name ?? "" })} />
              </section>
              <RevenuePanel by="rep" />
              <TimingPanel />
            </>
          );
        }}
      </Async>
      {open && <ProfileDrawer kind="rep" id={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </section>
  );
}
