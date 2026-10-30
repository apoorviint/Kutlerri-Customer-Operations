"use client";

import { Fragment, useState } from "react";
import { ANSWERED_KEYS, LABELS, NOT_ANSWERED_KEYS, colorOf, n0, pct, usd } from "@/lib/format";
import type { Node, Stats } from "@/lib/types";
import { Chevron, Dot } from "./ui";

type Sort = "calls" | "connects" | "meaningful" | null;

/**
 * Calls by Representative and client (or the other way round). A row with more than one inside opens to show them;
 * Answered and Not answered open to show the dispositions; the first three columns sort largest first.
 */
export default function CallsTable({ nodes, total, first, meaningfulSeconds, onOpen }: {
  nodes: Node[]; total: Stats; first: "rep" | "client"; meaningfulSeconds: number; onOpen: (id: number) => void;
}) {
  const [sort, setSort] = useState<Sort>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState({ answered: false, not_answered: false });

  const rows = sort ? [...nodes].sort((a, b) => b.stats[sort] - a.stats[sort] || b.stats.calls - a.stats.calls) : nodes;
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const childLabel = first === "rep" ? "clients" : "representatives";
  const kidName = (name: string) => (first === "rep" ? <><Dot color={colorOf(name)} />{name}</> : <>{name}</>);

  const cells = (s: Stats) => (
    <>
      <td>{n0(s.calls)}</td>
      <td>{n0(s.connects)} <span className="pct">({pct(s.connects, s.calls)})</span></td>
      <td>{n0(s.meaningful)} <span className="pct">({pct(s.meaningful, s.connects)})</span></td>
      <td>{n0(s.answered)}</td>
      <td>{n0(s.mql)} <span className="pct">({pct(s.mql, s.connects)})</span></td>
      {open.answered && ANSWERED_KEYS.map((k) => <td key={k} className="sa">{n0(s.dispositions[k])}</td>)}
      <td>{n0(s.notAnswered)}</td>
      {open.not_answered && NOT_ANSWERED_KEYS.map((k) => <td key={k} className="sn">{n0(s.dispositions[k])}</td>)}
      <td>{s.revenue ? usd(s.revenue) : <span className="na">–</span>}</td>
      <td>{s.kutlerriRevenue ? usd(s.kutlerriRevenue) : <span className="na">–</span>}</td>
    </>
  );
  const sortHead = (k: Exclude<Sort, null>, label: string, tip: string) => (
    <th title={tip} aria-sort={sort === k ? "descending" : "none"}>
      <button className={`srt${sort === k ? " on" : ""}`} onClick={() => setSort(sort === k ? null : k)}>{label}{sort === k && <> <span aria-hidden>▼</span></>}</button>
    </th>
  );
  const groupHead = (g: "answered" | "not_answered", label: string, keys: readonly (typeof ANSWERED_KEYS)[number][] | readonly (typeof NOT_ANSWERED_KEYS)[number][]) => (
    <>
      <th>
        <button className="tgl" aria-expanded={open[g]} title={`${open[g] ? "Hide" : "Show"} the breakdown`} onClick={() => setOpen({ ...open, [g]: !open[g] })}>
          {label} <span aria-hidden>{open[g] ? "▼" : "▶"}</span>
        </button>
      </th>
      {open[g] && keys.map((k) => <th key={k} className={`sub ${g === "answered" ? "sa" : "sn"}`}>{LABELS[k]}{k === "no_answer" ? "*" : ""}</th>)}
    </>
  );

  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th className="left">{first === "rep" ? "Name" : "Client"}</th>
            <th className="left">{first === "rep" ? "Client" : "Sales representative"}</th>
            {sortHead("calls", "Calls", "Click to sort high to low")}
            {sortHead("connects", "Connects", "Calls with one of the connect dispositions. Click to sort high to low.")}
            {sortHead("meaningful", "Meaningful conversations", `Connected calls with talk time over ${meaningfulSeconds} seconds. Click to sort high to low.`)}
            {groupHead("answered", "Answered", ANSWERED_KEYS)}
            <th>MQL</th>
            {groupHead("not_answered", "Not answered", NOT_ANSWERED_KEYS)}
            <th title="Item Total of the orders created in these dates">Order Value / Total Revenue</th>
            <th title="Kutlerri's share of the Item Total, at each client's rate">Kutlerri's Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const multi = x.children.length > 1, isOpen = multi && expanded.has(x.id);
            return (
              <Fragment key={x.id}>
                <tr className={multi ? "xp" : undefined} onClick={multi ? () => toggle(x.id) : undefined}>
                  <td className="name">
                    <span className="xslot">
                      {multi && (
                        <button className="xpd" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${x.name}'s ${first === "rep" ? "client" : "representative"}-wise data`}
                          title={`${isOpen ? "Hide" : "Show"} ${first === "rep" ? "client" : "representative"}-wise data`} onClick={(e) => { e.stopPropagation(); toggle(x.id); }}>
                          <Chevron />
                        </button>
                      )}
                    </span>
                    <button className="who" title="Open profile" onClick={(e) => { e.stopPropagation(); onOpen(x.id); }}>
                      {first === "client" && <Dot color={colorOf(x.name)} />}{x.name}
                    </button>
                  </td>
                  <td className="txt">{multi ? <span className="cl-count">{x.children.length} {childLabel}</span> : x.children[0] ? kidName(x.children[0].name) : ""}</td>
                  {cells(x.stats)}
                </tr>
                {isOpen && x.children.map((k) => (
                  <tr className="kid" key={k.id}><td className="name" /><td className="txt">{kidName(k.name)}</td>{cells(k.stats)}</tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot><tr><td className="name">Total</td><td />{cells(total)}</tr></tfoot>
      </table>
      {open.not_answered && <p className="pnote">* No Answer includes calls with no disposition.</p>}
    </div>
  );
}

