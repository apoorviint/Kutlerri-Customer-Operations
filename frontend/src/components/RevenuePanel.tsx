"use client";

import { Fragment, useState } from "react";
import { addDays, colorOf, fShort, n0, usd } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { Revenue } from "@/lib/types";
import { Async, Dot } from "./ui";

type Cell = Revenue["totals"][number];

/** Revenue by week, counted by the order's created date: one column per week, one row per Representative or client, hover for who it came from. */
export default function RevenuePanel({ by, forecast }: { by: "rep" | "client"; forecast?: boolean }) {
  const { qs } = useFilters();
  const [basis, setBasis] = useState<"order" | "payment">("order"); // which date the weeks are counted by
  // the forecast (from the proposals sheet, by close date) does not follow the date filter
  const state = useApi<Revenue>(forecast ? `/forecast/weekly?by=${by}` : `/revenue/weekly?by=${by}&${qs}${basis === "payment" ? "&date=payment" : ""}`);
  const s = state.data?.summary;

  // the forecast lists every proposal: its value, Probability, Representative and client
  const tip = (c: Cell) => c.items ? c.items.map((i) => `${usd(i.amount)} · ${i.probability ?? "no probability"} · ${i.representative} · ${i.client}`).join("\n") : c.by.map((b) => `${b.name}: ${b.orders} order${b.orders === 1 ? "" : "s"} · ${usd(b.revenue)}`).join("\n");
  const cell = (c: Cell | undefined) =>
    c ? <td title={tip(c)}>{usd(c.revenue)}<small>{n0(c.orders)} order{c.orders === 1 ? "" : "s"}</small></td> : <td className="na">–</td>;

  return (
    <section className="panel" id={`rv-${by}${forecast ? "-forecast" : ""}`}>
      <header className="rv-head">
        <h3>{forecast ? "Forecast revenue" : "GSV (Gross Sales Value)"}</h3>
        {!forecast && <div className="tm-mode" role="group" aria-label="Count orders by">
          <button className={basis === "order" ? "on" : ""} aria-pressed={basis === "order"} onClick={() => setBasis("order")}>Order date</button>
          <button className={basis === "payment" ? "on" : ""} aria-pressed={basis === "payment"} onClick={() => setBasis("payment")}>Payment date</button>
        </div>}
        {!forecast && s?.runRate != null && <span className="rv-run">Weekly run rate <b>{usd(s.runRate)}</b></span>}
      </header>
      <Async state={state}>
        {(r) => (
          <>
            <div className="tm-sum">
              <span>{forecast ? "Forecast revenue" : "GSV (Gross Sales Value)"} <b>{usd(r.summary.revenue)}</b></span>
              <span>{forecast ? "Proposals" : "Orders"} <b>{n0(r.summary.orders)}</b></span>
              <span>Avg {forecast ? "proposal" : "order"} <b>{r.summary.avgOrder != null ? usd(r.summary.avgOrder) : "–"}</b></span>
              <span>Representatives with orders <b>{r.summary.groupsWithOrders}</b></span>
            </div>
            {!r.summary.orders ? (
              <div className="empty">{forecast ? "No proposals to show. Upload the proposals sheet in the admin console." : basis === "payment" ? "No payments in the selected dates. Upload a billing sheet that has a payment tab." : "No orders in the selected dates."}</div>
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

