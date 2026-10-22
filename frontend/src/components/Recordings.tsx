"use client";

import { useEffect, useState } from "react";
import { ANSWERED_KEYS, LABELS, NOT_ANSWERED_KEYS, colorOf, fShort, fmtPhone, fmtTalk, n0 } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { DispositionKey, Prospect, Recording, Recordings as Data } from "@/lib/types";
import { Async, useDebounced } from "./ui";

const STEP = 50;

/** Who was called, as the databases know them: one person, several people sharing the number, or nobody we know. */
function ProspectLine({ r, showPhone }: { r: Recording; showPhone: boolean }) {
  const p: Prospect = r.prospect;
  if (p.kind === "none") return r.phone ? <div className="l3 none">Not in your databases · {fmtPhone(r.phone)}</div> : null;
  const rest = [p.title, p.company].filter(Boolean);
  return (
    <div className="l3">
      <b>{p.name}</b>
      {rest.map((t, i) => <span key={i} className="t"> · {t}</span>)}
      {showPhone && r.phone && <span className="t"> · {fmtPhone(r.phone)}</span>}
      {p.candidates && <span className="cand">Could be: {p.candidates}</span>}
    </div>
  );
}

/**
 * The calls of one Representative or client that have a recording. Search by prospect, company, title or number;
 * Answered / Not answered with the dispositions under each; newest first; "Listen" opens the recording.
 */
export default function Recordings({ kind, id, filterIds }: { kind: "rep" | "client"; id: number; filterIds: number[] }) {
  const { qs, meta } = useFilters();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"answered" | "not_answered" | null>(null);
  const [sub, setSub] = useState<DispositionKey | null>(null);
  const [limit, setLimit] = useState(STEP);
  const dq = useDebounced(q);
  const filterKey = filterIds.join(",");

  // a new search or filter starts again from the first fifty
  useEffect(() => { setLimit(STEP); }, [dq, category, sub, filterKey, qs]);

  const base = kind === "rep" ? `/reps/${id}` : `/clients/${id}`;
  const filter = filterIds.length ? `&${kind === "rep" ? "clients" : "reps"}=${filterKey}` : "";
  const path = `${base}/recordings?${qs}${filter}&limit=${limit}${dq ? `&q=${encodeURIComponent(dq)}` : ""}${category ? `&category=${category}` : ""}${category && sub ? `&sub=${sub}` : ""}`;
  const state = useApi<Data>(path);
  const showPhone = (name: string) => meta.clients.find((c) => c.name === name)?.showPhone ?? false;

  const pick = (c: "answered" | "not_answered") => { setCategory(category === c ? null : c); setSub(null); };
  const cat = category === "answered" ? ANSWERED_KEYS : NOT_ANSWERED_KEYS;

  return (
    <div>
      <input type="search" className="rsearch" aria-label="Search recordings by prospect" placeholder="Search a prospect, company, designation or phone number"
        value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <Async state={state}>
        {(d) => (
          <>
            <div className="chips" role="group" aria-label="Which recordings">
              <button aria-pressed={category === null} onClick={() => { setCategory(null); setSub(null); }}>All ({n0(d.counts.all)})</button>
            </div>
            <div className="chips tight" role="group" aria-label="Answered or not answered">
              <button aria-pressed={category === "answered"} onClick={() => pick("answered")}>Answered ({n0(d.counts.answered)})</button>
              <button aria-pressed={category === "not_answered"} onClick={() => pick("not_answered")}>Not answered ({n0(d.counts.notAnswered)})</button>
            </div>
            {category && (
              <div className="chips indent" role="group" aria-label={`${category === "answered" ? "Answered" : "Not answered"} breakdown`}>
                {cat.map((k) => <button key={k} aria-pressed={sub === k} onClick={() => setSub(sub === k ? null : k)}>{LABELS[k]} ({n0(d.counts.sub[k] ?? 0)})</button>)}
              </div>
            )}
            {d.items.length ? (
              <ul className="rlist">
                {d.items.map((r) => (
                  <li className="rrow" key={r.id}>
                    <div className="l1">{fShort(r.date)}<span>{r.time}</span></div>
                    <div className="l2">
                      {kind === "rep" ? <><span className="dot" style={{ background: colorOf(r.client) }} />{r.client}</> : r.representative}
                      {" · "}{fmtTalk(r.durationSec)} · {r.disposition ? LABELS[r.disposition] : "No disposition"}
                    </div>
                    <ProspectLine r={r} showPhone={showPhone(r.client)} />
                    <a className="listen" href={r.url} target="_blank" rel="noopener noreferrer" aria-label={`Listen to the ${fShort(r.date)} ${r.time} call recording`}>Listen ↗</a>
                  </li>
                ))}
              </ul>
            ) : <div className="pnote">No recordings for this selection.</div>}
            {d.hasMore && <button className="more" onClick={() => setLimit(limit + STEP)}>Show {Math.min(STEP, d.total - d.items.length)} more ({n0(d.total - d.items.length)} left)</button>}
            <div className="pnote">Newest first. Times are IST. Links open the recording in JustCall.</div>
            {category === "not_answered" && (!sub || sub === "no_answer") && <div className="pnote">{LABELS.no_answer} includes calls with no disposition.</div>}
          </>
        )}
      </Async>
    </div>
  );
}

