"use client";

import { Fragment } from "react";
import { addDays, colorOf, fShort, n0, usd } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { Revenue } from "@/lib/types";
import { Async, Dot } from "./ui";

type Cell = Revenue["totals"][number];

/** Revenue by week, counted by order date: one column per week, one row per Representative or client, hover for who it came from. */
export default function RevenuePanel({ by }: { by: "rep" | "client" }) {
  const { qs } = useFilters();
  const state = useApi<Revenue>(`/revenue/weekly?by=${by}&${qs}`);
  const s = state.data?.summary;

  const tip = (c: Cell) => c.by.map((b) => `${b.name}: ${b.orders} order${b.orders === 1 ? "" : "s"} · ${usd(b.revenue)}`).join("\n");
  const cell = (c: Cell | undefined) =>
    c ? <td title={tip(c)}>{usd(c.revenue)}<small>{n0(c.orders)} order{c.orders === 1 ? "" : "s"}</small></td> : <td className="na">–</td>;

  return (
    <section className="panel" id={`rv-${by}`}>
      <header className="rv-head">
        <h3>Revenue</h3>
        {s?.runRate != null && <span className="rv-run">Weekly run rate <b>{usd(s.runRate)}</b></span>}
      </header>
      <Async state={state}>
        {(r) => (
          <>
            <div className="tm-sum">
              <span>Revenue <b>{usd(r.summary.revenue)}</b></span>
              <span>Orders <b>{n0(r.summary.orders)}</b></span>
              <span>Avg order <b>{r.summary.avgOrder != null ? usd(r.summary.avgOrder) : "–"}</b></span>
              <span>Representatives with orders <b>{r.summary.groupsWithOrders}</b></span>
            </div>
            {!r.summary.orders ? (
              <div className="empty">No orders in the selected dates.</div>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th className="left">{by === "rep" ? "Sales representative" : "Client"}</th>
                      {r.weeks.map((w) => <th key={w.monday} className="rv-wk">Week {w.isoWeek}<small>{fShort(w.monday)} – {fShort(addDays(w.monday, 6))}</small></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="name txt">{by === "client" && <Dot color={colorOf(row.name)} />}{row.name}</td>
                        {r.weeks.map((w) => <Fragment key={w.monday}>{cell(row.cells[w.monday])}</Fragment>)}
                      </tr>
                    ))}
                    <tr className="rv-wtot">
                      <td className="name">Total</td>
                      {r.weeks.map((w, i) => <Fragment key={w.monday}>{cell(r.totals[i])}</Fragment>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Async>
    </section>
  );
}

