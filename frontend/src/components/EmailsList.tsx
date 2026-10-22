"use client";

import { useEffect, useState } from "react";
import { n0, pct } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { EmailDetail, EmailRow, Emails } from "@/lib/types";
import { Async, useDebounced } from "./ui";

const STEP = 50;
type Filter = "all" | "opened" | "replied" | "bounced";

/** Apollo's own date is Pacific time, so that is how an email's time is shown. */
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }) + " PT";

/**
 * An email, in a sandboxed frame (no scripts, nothing it contains can run). The text comes from the server already cleaned.
 * A reply is shown only when Apollo marks the email as replied.
 */
function Body({ id }: { id: string }) {
  const state = useApi<EmailDetail>(`/emails/${encodeURIComponent(id)}`);
  return (
    <Async state={state}>
      {(e) => (
        <div className="mbody">
          <div className="mmeta">From {e.fromEmail ?? "–"} · To {e.toEmail ?? "–"}</div>
          {e.bodyHtml ? (
            <iframe className="em-frame" sandbox="" referrerPolicy="no-referrer" title="Email content"
              srcDoc={`<meta charset="utf-8"><base target="_blank"><style>body{margin:12px;font:14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2937;background:#fff}img{max-width:100%}</style>${e.bodyHtml}`} />
          ) : <div className="pnote">The text of this email is not available from the data source yet.</div>}
          {e.replied && (
            <>
              <div className="mmeta rtitle">Reply</div>
              {e.replyText ? <pre className="em-reply">{e.replyText}</pre> : <div className="pnote">This email was replied to. The reply text is not available from the data source yet.</div>}
            </>
          )}
        </div>
      )}
    </Async>
  );
}

function Row({ e, open, onToggle }: { e: EmailRow; open: boolean; onToggle: () => void }) {
  return (
    <li className="mrow">
      <button className="mhead" aria-expanded={open} onClick={onToggle}>
        <span className="m1"><span className="msub">{e.subject || "(no subject)"}</span><span className="mdate">{when(e.sentAt)}</span></span>
        <span className="m2">{e.toName || e.toEmail}{e.toCompany ? ` · ${e.toCompany}` : ""}<span className="t"> · {e.toEmail}</span></span>
        <span className="m3">
          Step {e.step ?? "–"} · {e.sequence}
          {e.opened && <span className="em-st ok">Opened</span>}{e.clicked && <span className="em-st ok">Clicked</span>}
          {e.replied && <span className="em-st rep">Replied</span>}{e.bounced && <span className="em-st bad">Bounced</span>}{e.unsubscribed && <span className="em-st bad">Unsubscribed</span>}
        </span>
      </button>
      {open && <Body id={e.id} />}
    </li>
  );
}

export default function EmailsList({ clientId }: { clientId: number }) {
  const { qs } = useFilters();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(STEP);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const dq = useDebounced(q);
  useEffect(() => { setLimit(STEP); }, [dq, filter, qs]);

  const state = useApi<Emails>(`/clients/${clientId}/emails?${qs}&filter=${filter}&limit=${limit}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`);
  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chips: [Filter, string][] = [["all", "All"], ["opened", "Opened"], ["replied", "Replied"], ["bounced", "Bounced"]];

  return (
    <Async state={state}>
      {(d) => (
        <>
          <div className="em-sum">
            <span>Sent <b>{n0(d.summary.sent)}</b></span><span>Opened <b>{n0(d.summary.opened)}</b> ({pct(d.summary.opened, d.summary.sent)})</span>
            <span>Replied <b>{n0(d.summary.replied)}</b></span><span>Bounced <b>{n0(d.summary.bounced)}</b></span><span>Unsubscribed <b>{n0(d.summary.unsubscribed)}</b></span>
          </div>
          <input type="search" className="rsearch" aria-label="Search emails" placeholder="Search a name, company, email or subject" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <div className="chips" role="group" aria-label="Which emails">
            {chips.map(([k, label]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label} ({n0(d.counts[k])})</button>)}
          </div>
          {d.items.length ? <ul className="rlist">{d.items.map((e) => <Row key={e.id} e={e} open={openIds.has(e.id)} onToggle={() => toggle(e.id)} />)}</ul>
            : <div className="pnote">{d.summary.sent ? "No emails for this selection." : "No emails for this client in the selected dates."}</div>}
          {d.hasMore && <button className="more" onClick={() => setLimit(limit + STEP)}>Show {Math.min(STEP, d.total - d.items.length)} more ({n0(d.total - d.items.length)} left)</button>}
          <div className="pnote">Newest first. Click an email to read it. Times are as logged in Apollo (Pacific). Emails are for the whole client, so the Representative filter above does not apply.</div>
        </>
      )}
    </Async>
  );
}
