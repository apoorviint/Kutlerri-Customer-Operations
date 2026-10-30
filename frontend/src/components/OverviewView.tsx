"use client";

import { colorOf, fShort, n0, pct, usd } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { Overview } from "@/lib/types";
import { Async, Dot } from "./ui";

const Metric = ({ k, v, n, lead }: { k: string; v: string; n?: React.ReactNode; lead?: boolean }) => (
  <div className={`ov-m${lead ? " lead" : ""}`}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>
);
const Section = ({ title, cls, children, note }: { title: string; cls: string; children: React.ReactNode; note?: string }) => (
  <section className={`ov-sec ${cls}`}>
    <h3 className="ov-h"><i />{title}</h3>
    <div className="ov-grid">{children}</div>
    {note && <p className="pnote">{note}</p>}
  </section>
);

/** Revenue, calls and emails side by side for the selected dates, and one row per client. */
export default function OverviewView() {
  const { qs, from, to } = useFilters();
  const state = useApi<Overview>(`/overview?${qs}`);

  return (
    <section className="view" id="view-overview">
      <Async state={state}>
        {(o) => {
          const c = o.calls, e = o.emails, r = o.revenue;
          const empty = o.activeClients.count === 0;
          return (
            <>
              <div className="opsbar">{fShort(from)} – {fShort(to)}{o.weeksOfCalls ? ` · ${o.weeksOfCalls} week${o.weeksOfCalls === 1 ? "" : "s"} of calls` : ""}</div>
              {empty ? <div className="empty">No calls, orders or emails in the selected dates. Widen the date range above.</div> : (
                <>
                  <div className="ov-top"><Metric lead k="Active clients" v={n0(o.activeClients.count)} n={`of ${o.activeClients.of} clients · with calls, orders or emails in these dates`} /></div>

                  <Section title="Revenue" cls="ov-rev">
                    <Metric lead k="Order Value / Total Revenue" v={usd(r.total)} n={`${n0(r.orders)} order${r.orders === 1 ? "" : "s"} · by order created date`} />
                    <Metric k="Kutlerri's Revenue" v={usd(r.kutlerri)} n="Rate x Item Total, per client" />
                    <Metric k="Orders" v={n0(r.orders)} n={`${o.byClient.filter((x) => x.orders).length} client${o.byClient.filter((x) => x.orders).length === 1 ? "" : "s"}`} />
                    <Metric k="Average order" v={r.avgOrder != null ? usd(r.avgOrder) : "–"} n="Invoice total incl. tax, tip and fees" />
                    <Metric k="Weekly run rate" v={r.weeklyRunRate != null ? usd(r.weeklyRunRate) : "–"} n={r.weeks ? `Average over ${r.weeks} week${r.weeks === 1 ? "" : "s"}, from the first to the last week with orders` : undefined} />
                  </Section>
                  <p className="pnote" data-testid="billing-last-upload">Billing sheet last uploaded: {r.lastUpload ? new Date(r.lastUpload).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "not uploaded yet"}</p>

                  <Section title="Calls" cls="ov-call">
                    <Metric lead k="Total dials" v={n0(c.dials)} />
                    <Metric k="Connects/Answered" v={n0(c.connects)} n={`${pct(c.connects, c.dials)} of dials`} />
                    <Metric k="Meaningful conversations" v={n0(c.meaningful)} n={`${pct(c.meaningful, c.connects)} of connects · over 90 seconds`} />
                    <Metric k="MQLs" v={n0(c.mql)} n={<>Over 90 sec <b>{n0(c.mqlOver90)}</b> · 90 sec or less <b>{n0(c.mqlUnder90)}</b></>} />
                    <Metric k="MQL %" v={pct(c.mql, c.connects)} n="of connects" />
                    <Metric k="Not answered" v={n0(c.notAnswered)} n={`${pct(c.notAnswered, c.dials)} of dials`} />
                  </Section>

                  <Section title="Emails" cls="ov-mail"
                    note={e.clientsWithData < o.activeClients.of ? `Email data is available for ${e.clientsWithData} of ${o.activeClients.of} clients so far.` : undefined}>
                    <Metric lead k="Emails sent" v={n0(e.sent)} n={`${n0(e.delivered)} delivered · ${pct(e.delivered, e.sent)}`} />
                    <Metric k="Opened" v={n0(e.opened)} n={`${pct(e.opened, e.sent)} of sent`} />
                    <Metric k="Replied" v={n0(e.replied)} n={`${pct(e.replied, e.sent)} of sent`} />
                    <Metric k="Bounced" v={n0(e.bounced)} n={`${pct(e.bounced, e.sent)} of sent`} />
                    <Metric k="Unsubscribed" v={n0(e.unsubscribed)} n={`${pct(e.unsubscribed, e.sent)} of sent`} />
                  </Section>

                  <section className="ov-sec">
                    <h3 className="ov-h"><i />By client</h3>
                    <div className="panel"><div className="tablewrap">
                      <table>
                        <thead><tr><th className="left">Client</th><th>Dials</th><th>Connects</th><th>Meaningful conversations</th><th>MQLs</th><th>Orders</th><th>Order Value / Total Revenue</th><th>Kutlerri's Revenue</th><th>Emails sent</th><th>Delivered</th><th>Opened</th><th>Replied</th></tr></thead>
                        <tbody>
                          {o.byClient.map((x) => (
                            <tr key={x.clientId}>
                              <td className="name"><Dot color={colorOf(x.name)} />{x.name}</td>
                              <td>{n0(x.dials)}</td><td>{n0(x.connects)}</td><td>{n0(x.meaningful)}</td><td>{n0(x.mqls)}</td>
                              <td>{n0(x.orders)}</td><td>{x.orders ? usd(x.revenue) : <span className="na">–</span>}</td><td>{x.orders ? usd(x.kutlerriRevenue) : <span className="na">–</span>}</td>
                              <td>{n0(x.emailsSent)}</td><td>{n0(x.delivered)}</td><td>{n0(x.opened)} <span className="pct">({pct(x.opened, x.emailsSent)})</span></td><td>{n0(x.replied)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td className="name">Total</td><td>{n0(c.dials)}</td><td>{n0(c.connects)}</td><td>{n0(c.meaningful)}</td><td>{n0(c.mql)}</td>
                            <td>{n0(r.orders)}</td><td>{r.orders ? usd(r.total) : "–"}</td><td>{r.orders ? usd(r.kutlerri) : "–"}</td><td>{n0(e.sent)}</td><td>{n0(e.delivered)}</td><td>{n0(e.opened)} <span className="pct">({pct(e.opened, e.sent)})</span></td><td>{n0(e.replied)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div></div>
                  </section>
                </>
              )}
            </>
          );
        }}
      </Async>
    </section>
  );
}
