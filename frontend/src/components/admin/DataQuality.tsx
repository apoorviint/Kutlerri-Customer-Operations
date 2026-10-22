"use client";

import { Async } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { Notice, Section, Table, n, phone, when } from "./parts";

type Q = {
  alerts: string[];
  feeds: { calls: { lastSyncAt: string | null; newestRecordAt: string | null; hoursSinceNewest: number | null; stale: boolean; inShift: boolean }; emails: { lastSyncAt: string | null; newestRecordAt: string | null } };
  unassigned: { line: string | null; calls: number; first: string; last: string; agents: string[] | null }[];
  undecided: { line: string | null; calls: number; first: string; last: string }[];
  twoClients: { phone: string; client_a: string; client_b: string; from_a: string; to_a: string | null }[];
  swaps: { representative: string; phones: [string, string]; between: [string, string]; clients: [string, string] }[];
  discountMismatches: { invoiceNo: string; client: string; representative: string; orderDate: string | null; total: number; expected: number; difference: number }[];
  missingRecordings: { rep: string; calls: number; first: string; last: string }[];
  unmappedAgents: { id: number; name: string }[];
  unmappedEmails: { domain: string | null; emails: number }[];
};

const money = (v: number) => v.toLocaleString(undefined, { style: "currency", currency: "USD" });

export default function DataQuality() {
  const state = useApi<Q>("/admin/data-quality");
  return (
    <Async state={state}>
      {(q) => (
        <>
          {q.feeds.calls.stale && <Notice kind="bad">No new calls for {Math.floor(q.feeds.calls.hoursSinceNewest ?? 0)} hours during a shift. The call feed may be down.</Notice>}
          {q.alerts.filter((a) => !a.startsWith("No new calls")).map((a) => <Notice key={a} kind="warn">{a}</Notice>)}
          {!q.alerts.length && <Notice kind="ok">Nothing needs attention.</Notice>}

          <section className="panel">
            <header><h3>Feeds</h3></header>
            <Table head={["Source", "Last successful sync", "Newest record", "Status"]} rows={[
              ["Calls", when(q.feeds.calls.lastSyncAt), when(q.feeds.calls.newestRecordAt), q.feeds.calls.stale ? <b className="neg" key="s">Stale</b> : q.feeds.calls.inShift ? "Live (shift running)" : "Outside shift hours"],
              ["Emails", when(q.feeds.emails.lastSyncAt), when(q.feeds.emails.newestRecordAt), "—"],
            ]} />
          </section>

          <Section title="Calls with no client (phone line not on the sheet for that day)" count={q.unassigned.reduce((a, u) => a + u.calls, 0)} open={q.unassigned.length > 0}>
            <p className="na">Upload the sheet that lists these lines (Who dialed for whom) and the calls are assigned automatically.</p>
            <Table head={["Phone line", "Calls", "First seen", "Last seen", "Agents"]} empty="Every call has a client."
              rows={q.unassigned.map((u) => [phone(u.line), n(u.calls), u.first, u.last, (u.agents ?? []).join(", ") || "—"])} />
          </Section>

          <Section title="Calls on a shared line that could not be decided" count={q.undecided.reduce((a, u) => a + u.calls, 0)}>
            <Table head={["Phone line", "Calls", "First seen", "Last seen"]} empty="None."
              rows={q.undecided.map((u) => [phone(u.line), n(u.calls), u.first, u.last])} />
          </Section>

          <Section title="Phone lines listed for two clients in the same period" count={q.twoClients.length}>
            <Table head={["Phone line", "Client A", "Client B", "From", "To"]} empty="None."
              rows={q.twoClients.map((t) => [phone(t.phone), t.client_a, t.client_b, t.from_a, t.to_a ?? "open"])} />
          </Section>

          <Section title="Suspicious swaps (two numbers trade clients)" count={q.swaps.length}>
            <p className="na">This is how a mistyped column looks, like the Sep 28 and Oct 5 columns for Andrew. Nothing is changed automatically; check the sheet.</p>
            <Table head={["Representative", "Numbers", "Between", "Clients"]} empty="None."
              rows={q.swaps.map((s) => [s.representative, s.phones.map(phone).join(" and "), s.between.join(" → "), s.clients.join(" ↔ ")])} />
          </Section>

          <Section title="Orders where Total ≠ Subtotal + Tax + Tip + Fee − Discount" count={q.discountMismatches.length}>
            <Table head={["Invoice", "Client", "Representative", "Order date", "Total", "Expected", "Difference"]} empty="Every order adds up."
              rows={q.discountMismatches.map((o) => [o.invoiceNo, o.client, o.representative, o.orderDate ?? "—", money(o.total), money(o.expected), <b key="d" className="neg">{money(o.difference)}</b>])} />
          </Section>

          <Section title="Calls without a recording link" count={q.missingRecordings.reduce((a, m) => a + m.calls, 0)}>
            <Table head={["Representative", "Calls", "First", "Last"]} empty="Every call that connected has a recording."
              rows={q.missingRecordings.map((m) => [m.rep, n(m.calls), m.first, m.last])} />
          </Section>

          <Section title="Agents not mapped to a Representative" count={q.unmappedAgents.length}>
            <p className="na">Their calls cannot be counted until they are mapped. Use the Mappings tab.</p>
            <Table head={["Agent"]} empty="Every agent is mapped." rows={q.unmappedAgents.map((a) => [a.name])} />
          </Section>

          <Section title="Emails that could not be matched to a client" count={q.unmappedEmails.reduce((a, u) => a + u.emails, 0)}>
            <p className="na">The sender&apos;s domain is not on any client. Add a rule in Mappings → Email rules.</p>
            <Table head={["Sender domain", "Emails"]} empty="Every email has a client." rows={q.unmappedEmails.map((u) => [u.domain ?? "(none)", n(u.emails)])} />
          </Section>
        </>
      )}
    </Async>
  );
}
