import { DateTime } from "luxon";
import { addDays, mondayOf } from "./periods.js";

/** ISO week number (weeks run Monday to Sunday; Oct 5 to Oct 11, 2026 is week 41). */
export const isoWeek = (date: string) => DateTime.fromISO(date, { zone: "utc" }).weekNumber;

export type Order = { date: string; total: number; groupId: number; subId: number };
export type Cell = { revenue: number; orders: number; by: { id: number; orders: number; revenue: number }[] };

const money = (n: number) => Math.round(n * 100) / 100;

function cellOf(orders: Order[]): Cell {
  const by = new Map<number, { id: number; orders: number; revenue: number }>();
  let revenue = 0;
  for (const o of orders) {
    const b = by.get(o.subId) ?? by.set(o.subId, { id: o.subId, orders: 0, revenue: 0 }).get(o.subId)!;
    b.orders++; b.revenue += o.total; revenue += o.total;
  }
  return { revenue: money(revenue), orders: orders.length, by: [...by.values()].map((b) => ({ ...b, revenue: money(b.revenue) })).sort((a, b) => b.revenue - a.revenue || a.id - b.id) };
}

/**
 * Revenue by week. One column for every week from the first to the last week that has an order (a week with no orders
 * still counts, as $0); `groupId` is the row (a Representative or a client) and `subId` is the other one, for the hover list.
 * The weekly run rate is the total divided by the number of weeks in that span.
 */
export function weeklyRevenue(orders: Order[]) {
  if (!orders.length) return { weeks: [] as { monday: string; isoWeek: number; to: string }[], rows: [], totals: [] as Cell[], revenue: 0, orders: 0, avgOrder: null as number | null, runRate: null as number | null, groups: 0 };
  const mondays = orders.map((o) => mondayOf(o.date)).sort();
  const weeks: { monday: string; isoWeek: number; to: string }[] = [];
  for (let m = mondays[0]; m <= mondays[mondays.length - 1]; m = addDays(m, 7)) weeks.push({ monday: m, isoWeek: isoWeek(m), to: addDays(m, 6) });

  const byGroup = new Map<number, Order[]>();
  for (const o of orders) (byGroup.get(o.groupId) ?? byGroup.set(o.groupId, []).get(o.groupId)!).push(o);
  const rows = [...byGroup].map(([id, list]) => ({
    id,
    total: money(list.reduce((n, o) => n + o.total, 0)),
    cells: Object.fromEntries(weeks.map((w) => [w.monday, list.filter((o) => mondayOf(o.date) === w.monday)]).filter(([, l]) => (l as Order[]).length).map(([m, l]) => [m, cellOf(l as Order[])])) as Record<string, Cell>,
  })).sort((a, b) => b.total - a.total || a.id - b.id);

  const revenue = money(orders.reduce((n, o) => n + o.total, 0));
  return {
    weeks,
    rows,
    totals: weeks.map((w) => cellOf(orders.filter((o) => mondayOf(o.date) === w.monday))),
    revenue,
    orders: orders.length,
    avgOrder: money(revenue / orders.length),
    runRate: money(revenue / weeks.length),
    groups: byGroup.size,
  };
}
