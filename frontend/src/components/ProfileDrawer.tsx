"use client";

import { useEffect, useState } from "react";
import { colorOf, fShort, n0, pct, usd } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { Profile } from "@/lib/types";
import EmailsList from "./EmailsList";
import Recordings from "./Recordings";
import { Async, ChipPicker, Drawer } from "./ui";

const Tile = ({ k, v, n, wide }: { k: string; v: string; n?: React.ReactNode; wide?: boolean }) => (
  <div className={`tile${wide ? " wide" : ""}`}><div className="k">{k}</div><div className="v">{v}</div>{n && <div className="n">{n}</div>}</div>
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
  useEffect(() => { if (p && sel.some((s) => !p.selected.includes(s))) setSel(p.selected); }, [p, sel]);

  const chips = (
    <ChipPicker label={kind === "rep" ? "Choose clients" : "Choose representatives"} options={p?.options ?? []} selected={sel} onChange={setSel}
      dot={kind === "rep" ? colorOf : undefined} />
  );

  return (
    <Drawer titleId={`profile-${kind}-${id}`} title={name} chips={p ? chips : undefined} sub={<span>{fShort(from)} – {fShort(to)}</span>} onClose={onClose}>
      <Async state={state}>
        {(d) => {
          const s = d.stats;
          return (
            <>
              <div className="tiles">
                <Tile wide k="Calls" v={n0(s.calls)} />
                <Tile k="Connects" v={n0(s.connects)} />
                <Tile k="% of connects" v={pct(s.connects, s.calls)} n="of calls" />
                <Tile k="Meaningful conversations" v={n0(s.meaningful)} />
                <Tile k="% of meaningful conversations" v={pct(s.meaningful, s.connects)} n="of connects" />
                <Tile k="Answered" v={n0(s.answered)} />
                <Tile k="Not answered" v={n0(s.notAnswered)} />
                <Tile wide k="MQLs" v={n0(s.mql)} n={<>Over 90 sec <b>{n0(s.mqlOver90)}</b> · 90 sec or less <b>{n0(s.mqlUnder90)}</b></>} />
                {d.revenue && <Tile wide k="Revenue" v={usd(d.revenue.total)} n={`${n0(d.revenue.orders)} order${d.revenue.orders === 1 ? "" : "s"}`} />}
              </div>
              {!s.calls && <div className="pnote">No calls for this {kind === "rep" ? "representative" : "client"} in the selected dates.</div>}

              <button className="recbtn" aria-expanded={recOpen} onClick={() => setRecOpen(!recOpen)}>
                <span>Call recordings ({n0(d.recordings)})</span><span aria-hidden>{recOpen ? "▲" : "▼"}</span>
              </button>
              {recOpen && <Recordings kind={kind} id={id} filterIds={sel} />}

              {kind === "client" && (
                <>
                  <button className="recbtn" aria-expanded={mailOpen} onClick={() => setMailOpen(!mailOpen)}>
                    <span>Emails</span><span aria-hidden>{mailOpen ? "▲" : "▼"}</span>
                  </button>
                  {mailOpen && <EmailsList clientId={id} />}
                </>
              )}
            </>
          );
        }}
      </Async>
    </Drawer>
  );
}
