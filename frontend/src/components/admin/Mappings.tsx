"use client";

import { useEffect, useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import type { TimingSettings } from "@/lib/types";
import { ErrorBox, Notice, Section, Table, useAction } from "./parts";

type M = {
  representatives: { id: number; name: string; internal: boolean; merged_into: number | null }[];
  clients: { id: number; name: string; kind: string }[];
  agents: { id: number; name: string; representativeId: number | null; calls: number }[];
  apolloRules: { id: number; kind: string; value: string; clientId: number }[];
  tzRules: { id: number; agentKey: string | null; lineNo10: string | null; zone: string; validFrom: string; validTo: string | null; note: string | null }[];
  settings: { backfillStart: string; agentFallback: boolean; agentFallbackExcludedLines: string[]; timing: TimingSettings; prospectShow: Record<string, string[]> };
};

const json = (body: unknown): RequestInit => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export default function Mappings() {
  const [tick, setTick] = useState(0);
  const state = useApi<M>(`/admin/mappings?x=${tick}`);
  const reload = () => setTick((t) => t + 1);
  return (
    <Async state={state}>
      {(m) => (
        <>
          <Agents m={m} reload={reload} />
          <Merge m={m} reload={reload} />
          <EmailRules m={m} reload={reload} />
          <TimeZones m={m} reload={reload} />
          <Schedules m={m} reload={reload} />
          <Clients m={m} reload={reload} />
        </>
      )}
    </Async>
  );
}

function Agents({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [saved, setSaved] = useState<string | null>(null);
  const [rep, setRep] = useState("");
  async function map(id: number, value: string) {
    const r = await act.run(() => api(`/admin/agents/${id}`, { method: "PUT", ...json({ representativeId: value ? Number(value) : null }) }));
    if (r) { setSaved("Saved. Calls are being recalculated in the background."); reload(); }
  }
  async function addRep() {
    const r = await act.run(() => api("/admin/representatives", { method: "POST", ...json({ name: rep }) }));
    if (r) { setRep(""); setSaved("Representative added."); reload(); }
  }
  const unmapped = m.agents.filter((a) => a.representativeId === null);
  return (
    <Section title="Agents → Representatives" count={unmapped.length} open={unmapped.length > 0}>
      <p className="na">An agent is the real person logged in to the calling tool; the Representative is the working name shown in the dashboards. Calls by an unmapped agent are not counted for anyone.</p>
      <ErrorBox error={act.error} />
      {saved && <Notice kind="ok">{saved}</Notice>}
      <Table head={["Agent", "Calls", "Representative"]} empty="No agents yet." rows={m.agents.map((a) => [
        a.name, a.calls.toLocaleString(),
        <select key="s" aria-label={`Representative for ${a.name}`} value={a.representativeId ?? ""} disabled={act.busy} onChange={(e) => map(a.id, e.target.value)}>
          <option value="">— not mapped —</option>
          {m.representatives.filter((r) => !r.merged_into).map((r) => <option key={r.id} value={r.id}>{r.name}{r.internal ? " (internal)" : ""}</option>)}
        </select>,
      ])} />
      <div className="adm-form">
        <label>New Representative<input value={rep} onChange={(e) => setRep(e.target.value)} placeholder="Working name" /></label>
        <button className="btn" disabled={!rep.trim() || act.busy} onClick={addRep}>Add</button>
      </div>
    </Section>
  );
}

/** Two working names that are one person (Peter and Pranav): one is merged into the other, everywhere. */
function Merge({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [from, setFrom] = useState("");
  const [into, setInto] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const live = m.representatives.filter((r) => !r.merged_into);
  const merged = m.representatives.filter((r) => r.merged_into);
  const nameOf = (id: number | null) => m.representatives.find((r) => r.id === id)?.name ?? "";
  async function go() {
    if (!confirm(`Merge ${nameOf(Number(from))} into ${nameOf(Number(into))}? All of ${nameOf(Number(from))}'s calls, orders and proposals will count for ${nameOf(Number(into))}. This cannot be undone here.`)) return;
    const r = await act.run(() => api("/admin/representatives/merge", { method: "POST", ...json({ from: Number(from), into: Number(into) }) }));
    if (r) { setDone("Merged. Calls are being recalculated in the background."); setFrom(""); setInto(""); reload(); }
  }
  return (
    <Section title="Same person (merge Representatives)" count={0}>
      <p className="na">Use this when two working names are one person, for example Peter and Pranav. The first name is merged into the second: they then show as one everywhere (the Rep table, timing, revenue), and a sheet that still uses the first name counts for the second.</p>
      <ErrorBox error={act.error} />
      {done && <Notice kind="ok">{done}</Notice>}
      <div className="adm-form">
        <label>Merge this name
          <select aria-label="Name to merge" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose…</option>
            {live.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label>Into
          <select aria-label="Name that stays" value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">Choose…</option>
            {live.filter((r) => String(r.id) !== from).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!from || !into || act.busy} onClick={go}>{act.busy ? "Merging…" : "Merge"}</button>
      </div>
      <Table head={["Merged name", "Now counts as"]} empty="Nothing merged yet." rows={merged.map((r) => [r.name, nameOf(r.merged_into)])} />
    </Section>
  );
}

function EmailRules({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [kind, setKind] = useState("domain");
  const [value, setValue] = useState("");
  const [clientId, setClientId] = useState("");
  const clients = m.clients;
  const name = (id: number) => m.clients.find((c) => c.id === id)?.name ?? id;
  async function add() {
    const r = await act.run(() => api("/admin/apollo-rules", { method: "POST", ...json({ kind, value, clientId: Number(clientId) }) }));
    if (r) { setValue(""); reload(); }
  }
  async function del(id: number) {
    const r = await act.run(() => api(`/admin/apollo-rules/${id}`, { method: "DELETE" }));
    if (r) reload();
  }
  return (
    <Section title="Email rules: which sender belongs to which client" count={m.apolloRules.length} open={false}>
      <p className="na">The sender&apos;s domain decides the client. A single mailbox or a sequence name can override the domain (mailbox first, then sequence, then domain). Emails are re-matched after a change.</p>
      <ErrorBox error={act.error} />
      <Table head={["Type", "Value", "Client", ""]} rows={m.apolloRules.map((r) => [r.kind, r.value, name(r.clientId), <button key="d" className="btn small" disabled={act.busy} onClick={() => confirm(`Delete the rule for ${r.value}?`) && del(r.id)}>Delete</button>])} />
      <div className="adm-form">
        <label>Type<select aria-label="Rule type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="domain">Domain</option><option value="mailbox">Mailbox</option><option value="sequence">Sequence name</option></select></label>
        <label>Value<input aria-label="Rule value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "domain" ? "example.com" : kind === "mailbox" ? "name@example.com" : "sequence name"} /></label>
        <label>Client<select aria-label="Rule client" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="btn" disabled={!value.trim() || !clientId || act.busy} onClick={add}>Add rule</button>
      </div>
    </Section>
  );
}

function TimeZones({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [f, setF] = useState({ agentName: "", lineNo10: "", zone: "America/Chicago", validFrom: "", validTo: "", note: "" });
  async function add() {
    const body = { agentName: f.agentName || undefined, lineNo10: f.lineNo10 || undefined, zone: f.zone, validFrom: f.validFrom, validTo: f.validTo || null, note: f.note || undefined };
    const r = await act.run(() => api("/admin/tz-rules", { method: "POST", ...json(body) }));
    if (r) { setF({ ...f, agentName: "", lineNo10: "", note: "" }); reload(); }
  }
  async function del(id: number) {
    const r = await act.run(() => api(`/admin/tz-rules/${id}`, { method: "DELETE" }));
    if (r) reload();
  }
  return (
    <Section title="Time zone rules (agents whose calling-tool clock differs)" count={m.tzRules.length}>
      <p className="na">Calls are logged in US Eastern time by default. If an agent&apos;s clock is set to another zone from some date, add it here and their calls are corrected from that date (to IST, with daylight saving). Use a name like America/Chicago, or a fixed offset like UTC-3.</p>
      <ErrorBox error={act.error} />
      <Table head={["Agent", "Phone line", "Zone", "From", "To", "Note", ""]} rows={m.tzRules.map((r) => [r.agentKey ?? "—", r.lineNo10 ?? "—", r.zone, r.validFrom, r.validTo ?? "open", r.note ?? "", <button key="d" className="btn small" disabled={act.busy} onClick={() => confirm("Delete this rule? The calls are re-timed.") && del(r.id)}>Delete</button>])} />
      <div className="adm-form">
        <label>Agent<input value={f.agentName} onChange={(e) => setF({ ...f, agentName: e.target.value })} placeholder="Name as in the calling tool" /></label>
        <label>or phone line<input value={f.lineNo10} onChange={(e) => setF({ ...f, lineNo10: e.target.value })} placeholder="(555) 123-4567" /></label>
        <label>Zone<input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} /></label>
        <label>From<input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></label>
        <label>To (optional)<input type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></label>
        <button className="btn" disabled={!f.validFrom || (!f.agentName.trim() && !f.lineNo10.trim()) || act.busy} onClick={add}>Add rule</button>
      </div>
    </Section>
  );
}

function Schedules({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [t, setT] = useState<TimingSettings>(m.settings.timing);
  const [fallback, setFallback] = useState(m.settings.agentFallback);
  const [excluded, setExcluded] = useState(m.settings.agentFallbackExcludedLines.join(", "));
  const [start, setStart] = useState(m.settings.backfillStart);
  const [saved, setSaved] = useState<string | null>(null);
  const [chg, setChg] = useState({ from: "", client: "", breakStart: "", breakEnd: "" });
  useEffect(() => { setT(m.settings.timing); setFallback(m.settings.agentFallback); setExcluded(m.settings.agentFallbackExcludedLines.join(", ")); setStart(m.settings.backfillStart); }, [m.settings]);

  const customers = m.clients.filter((c) => c.kind === "CUSTOMER");
  const sched = (name: string | null) => (name === null ? t.default : (t.clients[name] ?? t.default));
  const setSched = (name: string | null, k: "start" | "breakStart" | "breakEnd", v: string) => {
    if (name === null) setT({ ...t, default: { ...t.default, [k]: v } });
    else setT({ ...t, clients: { ...t.clients, [name]: { ...sched(name), [k]: v } } });
  };
  const changes = t.breakChanges ?? [];
  const addChange = () => {
    setT({ ...t, breakChanges: [...changes, { from: chg.from, client: chg.client || null, breakStart: chg.breakStart, breakEnd: chg.breakEnd }].sort((a, b) => a.from.localeCompare(b.from)) });
    setChg({ ...chg, from: "" });
  };
  const num = (k: keyof Pick<TimingSettings, "gapMinutes" | "breakMinMinutes" | "windowMinutes" | "graceMinutes" | "allowedBreakMinutes">, label: string) => (
    <label key={k}>{label}<input type="number" min={0} value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} /></label>
  );

  async function save() {
    setSaved(null);
    // "(570) 456-3531", "570-456-3531" and "15704563531" are the same line: its last ten digits
    const lines = excluded.split(/[,;\n]+/).map((x) => x.replace(/\D/g, "").slice(-10)).filter(Boolean);
    const r = await act.run(() => api<{ changed: string[] }>("/admin/settings", { method: "PUT", ...json({ timing: t, agentFallback: fallback, agentFallbackExcludedLines: lines, backfillStart: start }) }));
    if (r) { setSaved(r.changed.length ? `Saved: ${r.changed.join(", ")}.` : "Nothing changed."); reload(); }
  }

  return (
    <Section title="Schedules, breaks and rules" open={false}>
      <p className="na">Shift start and break times in IST, as 24-hour clock. Clients without their own row use the default.</p>
      <Table head={["Client", "Starts", "Break starts", "Break ends"]} rows={[null, ...customers.map((c) => c.name)].map((name) => [
        name ?? "Default (everyone else)",
        ...(["start", "breakStart", "breakEnd"] as const).map((k) => <input key={k} type="time" aria-label={`${name ?? "Default"} ${k}`} value={sched(name)[k]} onChange={(e) => setSched(name, k, e.target.value)} />),
      ])} />
      <h4>Break time changes</h4>
      <p className="na">To move a break from a date onwards (for example when US clocks change), add it here. Until that date the times above are used. A change for Default moves every client that has no row of its own. A time after midnight (like 00:30) is the same shift. Press Save settings after adding.</p>
      <Table head={["From", "Client", "Break starts", "Break ends", ""]} empty="No changes." rows={changes.map((c, i) => [
        c.from, c.client ?? "Default (everyone else)", c.breakStart, c.breakEnd,
        <button key="d" className="btn small" onClick={() => setT({ ...t, breakChanges: changes.filter((_, j) => j !== i) })}>Remove</button>,
      ])} />
      <div className="adm-form">
        <label>From<input type="date" value={chg.from} onChange={(e) => setChg({ ...chg, from: e.target.value })} /></label>
        <label>Client<select value={chg.client} onChange={(e) => setChg({ ...chg, client: e.target.value })}><option value="">Default (everyone else)</option>{customers.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
        <label>Break starts<input type="time" value={chg.breakStart} onChange={(e) => setChg({ ...chg, breakStart: e.target.value })} /></label>
        <label>Break ends<input type="time" value={chg.breakEnd} onChange={(e) => setChg({ ...chg, breakEnd: e.target.value })} /></label>
        <button className="btn" disabled={!chg.from || !chg.breakStart || !chg.breakEnd} onClick={addChange}>Add change</button>
      </div>
      <div className="adm-form">
        {num("gapMinutes", "A pause counts from (min)")}{num("breakMinMinutes", "A break is at least (min)")}{num("windowMinutes", "…and starts within (min of schedule)")}
        {num("graceMinutes", "On time means within (min)")}{num("allowedBreakMinutes", "Allowed break (min)")}
      </div>
      <h4>Which Representative a call belongs to</h4>
      <label className="check"><input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> Count calls on a line that is not on the sheet for the agent&apos;s Representative, when that is clear (off: such calls are left out)</label>
      <div className="adm-form"><label>Lines that always stay unassigned<input value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="3464233909, 6823563013" /></label></div>
      <h4>Data shown from</h4>
      <div className="adm-form"><label>Start date<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label></div>
      <p className="na">Nothing before this date is stored or shown. To bring in earlier days after moving it back, run the Calls and Emails jobs for that range in the Jobs tab.</p>
      <ErrorBox error={act.error} />
      {saved && <Notice kind="ok">{saved}</Notice>}
      <div className="adm-actions"><button className="btn primary" disabled={act.busy} onClick={save}>{act.busy ? "Saving…" : "Save settings"}</button></div>
    </Section>
  );
}

function Clients({ m, reload }: { m: M; reload: () => void }) {
  const act = useAction();
  const [name, setName] = useState("");
  async function add() {
    const r = await act.run(() => api("/admin/clients", { method: "POST", ...json({ name }) }));
    if (r) { setName(""); reload(); }
  }
  return (
    <Section title="Clients" count={m.clients.filter((c) => c.kind === "CUSTOMER").length} open={false}>
      <Table head={["Client", "Type"]} rows={m.clients.map((c) => [c.name, c.kind === "CUSTOMER" ? "Customer" : "Internal (never shown)"])} />
      <div className="adm-form">
        <label>New client<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" /></label>
        <button className="btn" disabled={!name.trim() || act.busy} onClick={add}>Add client</button>
      </div>
      <ErrorBox error={act.error} />
    </Section>
  );
}
