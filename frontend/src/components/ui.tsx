"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num, shortDay } from "@/lib/format";

export function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "calls" | "emails" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        {accent && <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-sm ${accent === "calls" ? "bg-calls" : "bg-emails"}`} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-semibold">{title}</h2>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Tip({ active, payload, label, unit, labelFmt }: {
  active?: boolean; payload?: { value: number }[]; label?: string; unit: string; labelFmt?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="text-ink-2">{labelFmt ? labelFmt(String(label)) : label}</div>
      <div className="font-semibold tabular-nums">{num(payload[0].value)} {unit}</div>
    </div>
  );
}

const axis = { fontSize: 11, fill: "var(--ink-3)" };

/** Daily counts: one series, so no legend box (the card title names it). */
export function DayBars({ data, color, unit }: { data: { day: string; count: number }[]; color: string; unit: string }) {
  const empty = data.every((d) => d.count === 0);
  return (
    <div className="h-56" role="img" aria-label={`${unit} per day`}>
      {empty ? (
        <p className="grid h-full place-items-center text-sm text-ink-3">No data in this range.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="day" tickFormatter={shortDay} tick={axis} tickLine={false} axisLine={{ stroke: "var(--line)" }} minTickGap={24} />
            <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--grid)" }} content={<Tip unit={unit} labelFmt={shortDay} />} />
            <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Horizontal bars with the label on the axis; one series, so no legend. */
export function RankBars({ data, color, unit }: { data: { name: string; value: number }[]; color: string; unit: string }) {
  if (data.length === 0) return <p className="grid h-40 place-items-center text-sm text-ink-3">No data in this range.</p>;
  return (
    <div style={{ height: Math.max(160, data.length * 28 + 24) }} role="img" aria-label={`${unit} by agent`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={110} tick={{ ...axis, fill: "var(--ink-2)" }} tickLine={false} axisLine={false} interval={0} />
          <Tooltip cursor={{ fill: "var(--grid)" }} content={<Tip unit={unit} />} />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Table({ head, rows, empty = "No rows." }: { head: string[]; rows: React.ReactNode[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-ink-3">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {r.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-4 text-ink-3">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  return (
    <div className="mt-3 flex items-center gap-3 text-sm text-ink-2">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Prev</button>
      <span className="tabular-nums">Page {page} of {pages.toLocaleString()} · {total.toLocaleString()} rows</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded border border-line px-3 py-1 disabled:opacity-40">Next</button>
    </div>
  );
}

export const inputCls = "rounded-md border border-line bg-transparent px-3 py-1.5 text-sm";
