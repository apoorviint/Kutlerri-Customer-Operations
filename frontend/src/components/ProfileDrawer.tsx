"use client";

import { useEffect, useState } from "react";
import { colorOf, fShort, n0, pct, usd } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { Profile } from "@/lib/types";
import EmailsList from "./EmailsList";
import Recordings from "./Recordings";
import { Async, ChipPicker } from "./ui";

const Tile = ({ k, v, n, wide, hl, full }: { k: string; v: string; n?: React.ReactNode; wide?: boolean; hl?: boolean; full?: boolean }) => (
  <div className={`tile${wide ? " wide" : ""}${hl ? " hl" : ""}${full ? " full" : ""}`}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>
);

/**
 * The profile of one Representative (their clients as chips) or one client (their Representatives as chips):
 * the numbers for the selected dates, the call recordings, and for a client its emails.
 */
export default function ProfileDrawer({ kind, id, name, onClose }: { kind: "rep" | "client"; id: number; name: string; onClose: () => void }) {
  const { qs, from, to } = useFilters();
  const [sel, setSel] = useState<number[]>([]);
  const [recOpen, setRecOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);

  const path = `${kind === "rep" ? "/reps" : "/clients"}/${id}/profile?${qs}${sel.length ? `&${kind === "rep" ? "clients" : "reps"}=${sel.join(",")}` : ""}`;
  const state = useApi<Profile>(path);
  const p = state.data;
  // a chip with no calls in the new dates is dropped by the server; follow it
  // (only when new data arrives: right after a click the old data does not have the chip yet)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (p && sel.some((s) => !p.selected.includes(s))) setSel(p.selected); }, [p]);

  // a full page: start at the top, and Escape goes back
  useEffect(() => {
    window.scrollTo(0, 0);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chips = (
    <ChipPicker label={kind === "rep" ? "Choose clients" : "Choose representatives"} options={p?.options ?? []} selected={sel} onChange={setSel}
      dot={kind === "rep" ? colorOf : undefined} />
  );

  return (
    <div className="ppage">
      <header className="phead">
        <div>
          <div className="ptop"><button className="pback" onClick={onClose}>← Back</button><h2 id={`profile-${kind}-${id}`}>{name}</h2>{p ? chips : null}</div>
          <div className="psub"><span>{fShort(from)} – {fShort(to)} · change the dates in the bar above</span></div>
        </div>
      </header>
      <div className="pbody">
      <Async state={state}>
        {(d) => {
          const s = d.stats;
          return (
            <>
              <div className="tiles">
                <Tile k="Calls" v={n0(s.calls)} />
                <Tile k="Connects/Answered" v={n0(s.connects)} />
                <Tile hl k="% of connects" v={pct(s.connects, s.calls)} n="of calls" />
                <Tile k="Not answered" v={n0(s.notAnswered)} />
                <Tile k="Meaningful conversations" v={n0(s.meaningful)} />
                <Tile hl k="% of meaningful conversations" v={pct(s.meaningful, s.connects)} n="of connects" />
                <Tile k="MQLs" v={n0(s.mql)} n={<>Over 90 sec <b>{n0(s.mqlOver90)}</b> · 90 sec or less <b>{n0(s.mqlUnder90)}</b></>} />
                <Tile hl k="MQL %" v={pct(s.mql, s.connects)} n="of connects" />
                {d.revenue && <Tile full k="Revenue" v={usd(d.revenue.total)} n={`${n0(d.revenue.orders)} order${d.revenue.orders === 1 ? "" : "s"}`} />}
              </div>
              {!s.calls && <div className="pnote">No calls for this {kind === "rep" ? "representative" : "client"} in the selected dates.</div>}

              <div className={`pcols${kind === "client" ? " two" : ""}`}>
                <div className="pcol">
                  <button className="recbtn" aria-expanded={recOpen} onClick={() => setRecOpen(!recOpen)}>
                    <span>Call recordings ({n0(d.recordings)})</span><span aria-hidden>{recOpen ? "▲" : "▼"}</span>
                  </button>
                  {recOpen && <Recordings kind={kind} id={id} filterIds={sel} />}
                </div>
                {kind === "client" && (
                  <div className="pcol">
                    <button className="recbtn" aria-expanded={mailOpen} onClick={() => setMailOpen(!mailOpen)}>
                      <span>Emails</span><span aria-hidden>{mailOpen ? "▲" : "▼"}</span>
                    </button>
                    {mailOpen && <EmailsList clientId={id} />}
                  </div>
                )}
              </div>
            </>
          );
        }}
      </Async>
      </div>
    </div>
  );
}
