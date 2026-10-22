import { covers, periodLength } from "./periods.js";

export type Assignment = {
  id: number;
  phoneNo10: string;
  representativeId: number;
  clientId: number;
  clientKind: "CUSTOMER" | "INTERNAL";
  validFrom: string;
  validTo: string | null;
  priority: number; // 1 = from an uploaded sheet, 0 = a standing fallback
};

export type AttributionStatus = "CLIENT" | "INTERNAL" | "UNASSIGNED" | "CONFLICT";
export type AttributionReason = "sheet" | "fallback" | "shared-line-by-agent" | "agent-fallback" | "no-assignment" | "ambiguous";


export type Attribution = {
  status: AttributionStatus;
  clientId: number | null;
  representativeId: number | null;
  assignmentId: number | null;
  reason: AttributionReason;
};

const UNASSIGNED: Attribution = { status: "UNASSIGNED", clientId: null, representativeId: null, assignmentId: null, reason: "no-assignment" };

/**
 * Which Representative and client a call belongs to.
 *
 * `rows` are the assignments for the call's phone line. Of the rows that cover the shift day, the best one wins:
 * a sheet beats a standing fallback, and a shorter period (a day) beats a longer one (a week, a month).
 * If one line is listed for two Representatives in the same period (it happened once), the call's agent decides.
 * A line with no row is Unassigned; a line assigned to Kutlerri is Internal. Both are kept but never shown in the dashboards.
 */
export function attributeCall(
  rows: Assignment[], shiftDate: string, agentRepresentativeId: number | null,
  agentRows: Assignment[] | null = null, usedClients: ReadonlySet<number> | null = null,
): Attribution {
  const live = rows.filter((r) => covers(r.validFrom, r.validTo, shiftDate));
  if (!live.length) return agentFallback(agentRows, shiftDate, agentRepresentativeId, usedClients) ?? UNASSIGNED;

  const rank = (r: Assignment) => [r.priority, -periodLength(r.validFrom, r.validTo)] as const;
  const best = live.reduce((a, r) => {
    const x = rank(r), y = rank(a);
    return x[0] > y[0] || (x[0] === y[0] && x[1] > y[1]) ? r : a;
  });
  const top = live.filter((r) => r.priority === best.priority && periodLength(r.validFrom, r.validTo) === periodLength(best.validFrom, best.validTo));

  // distinct (client, representative) pairs among the equally good rows
  const pairs = new Map<string, Assignment>();
  for (const r of top) pairs.set(`${r.clientId}:${r.representativeId}`, pairs.get(`${r.clientId}:${r.representativeId}`) ?? r);
  const reason = best.priority === 0 ? "fallback" : "sheet";

  let chosen: Assignment | undefined;
  let why: AttributionReason = reason;
  if (pairs.size === 1) {
    chosen = [...pairs.values()][0];
  } else {
    const byAgent = [...pairs.values()].filter((r) => agentRepresentativeId !== null && r.representativeId === agentRepresentativeId);
    if (byAgent.length === 1) {
      chosen = byAgent[0];
      why = "shared-line-by-agent";
    }
  }
  if (!chosen) return { status: "CONFLICT", clientId: null, representativeId: null, assignmentId: null, reason: "ambiguous" };
  return {
    status: chosen.clientKind === "INTERNAL" ? "INTERNAL" : "CLIENT",
    clientId: chosen.clientId,
    representativeId: chosen.representativeId,
    assignmentId: chosen.id,
    reason: why,
  };
}

/**
 * For a call on a line that is not on the sheet for that day, the agent's Representative decides, when that is clear:
 *  1. if the Representative dialed from listed lines of exactly one client that same shift day (`usedClients`), the call
 *     belongs to that client (this resolves a Representative with two clients on the sheet but only one in use);
 *  2. otherwise, if the sheet gives the Representative exactly one customer client that day, that client
 *     (Kutlerri's own lines are ignored); a Representative with only Kutlerri lines gives an Internal call;
 *  3. otherwise the call stays Unassigned rather than guessed.
 * The prototype behaves this way and its numbers depend on it. It is switched on or off by the `agentFallback` setting
 * (`agentRows` is null when off).
 */
function agentFallback(
  agentRows: Assignment[] | null, shiftDate: string, representativeId: number | null, usedClients: ReadonlySet<number> | null,
): Attribution | null {
  if (!agentRows || representativeId === null) return null;
  const live = agentRows.filter((r) => r.priority > 0 && r.representativeId === representativeId && covers(r.validFrom, r.validTo, shiftDate));
  const done = (clientId: number, kind: "CUSTOMER" | "INTERNAL", row?: Assignment): Attribution => ({
    status: kind === "INTERNAL" ? "INTERNAL" : "CLIENT", clientId, representativeId, assignmentId: row?.id ?? null, reason: "agent-fallback",
  });
  if (usedClients && usedClients.size === 1) {
    const clientId = [...usedClients][0];
    return done(clientId, "CUSTOMER", live.find((r) => r.clientId === clientId));
  }
  if (!live.length) return null;
  const shortest = Math.min(...live.map((r) => periodLength(r.validFrom, r.validTo)));
  const best = live.filter((r) => periodLength(r.validFrom, r.validTo) === shortest);
  const customers = best.filter((r) => r.clientKind === "CUSTOMER");
  const pool = customers.length ? customers : best;
  if (new Set(pool.map((r) => r.clientId)).size !== 1) return null;
  return done(pool[0].clientId, pool[0].clientKind, pool[0]);
}

// ───────────── checking a sheet ─────────────

export type SheetRow = { phoneNo10: string; representative: string; client: string; from: string; to: string | null };

export type Swap = { representative: string; phones: [string, string]; between: [string, string]; clients: [string, string] };

/**
 * Looks for two of one Representative's numbers whose clients trade places from one period to the next.
 * That is how a mistyped sheet looks (the Sep 28 and Oct 5 columns for Andrew). It is reported, never "fixed".
 */
export function findSuspiciousSwaps(rows: SheetRow[]): Swap[] {
  const byRep = new Map<string, SheetRow[]>();
  for (const r of rows) (byRep.get(r.representative) ?? byRep.set(r.representative, []).get(r.representative)!).push(r);
  const out: Swap[] = [];
  for (const [rep, list] of byRep) {
    const periods = [...new Set(list.map((r) => `${r.from}|${r.to}`))].sort();
    for (let i = 0; i + 1 < periods.length; i++) {
      const clientIn = (p: string) => {
        const m = new Map<string, Set<string>>();
        for (const r of list) if (`${r.from}|${r.to}` === p) (m.get(r.phoneNo10) ?? m.set(r.phoneNo10, new Set()).get(r.phoneNo10)!).add(r.client);
        return m;
      };
      const a = clientIn(periods[i]), b = clientIn(periods[i + 1]);
      const phones = [...a.keys()].filter((p) => b.has(p) && a.get(p)!.size === 1 && b.get(p)!.size === 1);
      for (let x = 0; x < phones.length; x++) {
        for (let y = x + 1; y < phones.length; y++) {
          const [p, q] = [phones[x], phones[y]];
          const [pa, qa] = [[...a.get(p)!][0], [...a.get(q)!][0]];
          const [pb, qb] = [[...b.get(p)!][0], [...b.get(q)!][0]];
          if (pa !== qa && pa === qb && qa === pb) out.push({ representative: rep, phones: [p, q], between: [periods[i].split("|")[0], periods[i + 1].split("|")[0]], clients: [pa, qa] });
        }
      }
    }
  }
  return out;
}
