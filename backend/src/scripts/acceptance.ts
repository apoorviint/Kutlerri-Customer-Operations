/**
 * Checks the call numbers against the acceptance figures (shift days 2026-08-17 to 2026-10-09, client lines only).
 *
 *   npx tsx src/scripts/acceptance.ts ["<prototype HTML>"]
 *
 * With the prototype HTML it prints a second table that counts only the calls the prototype's workbook also contains,
 * which separates the attribution rules from differences in the call source, and lists where the daily counts differ.
 */
import { readFileSync } from "node:fs";
import { db } from "../db.js";
import { CONNECT_KEYS, isConnect, isMeaningful, isMqlOver90, last10 } from "../rules/calls.js";

const FROM = "2026-08-17", TO = "2026-10-09";

const EXPECTED = {
  dials: 49971, connects: 4160, meaningful: 1538, mql: 1023, mqlOver90: 828, mqlUnder90: 195,
  byClient: { "Rasa": 16835, "Cedar's": 10028, "Gyro Republic": 8619, "HotChi": 8568, "Kati Roll": 3527, "Eight Turn Crepe": 2394 } as Record<string, number>,
  sep10: 274,
};

type Totals = { dials: number; connects: number; meaningful: number; mql: number; mqlOver90: number; byClient: Record<string, number>; sep10: number };
type Row = { client: string; rep: string; line: string | null; shift: string; calls: number; connects: number; meaningful: number; mql: number; mql_over_90: number };
type Seed = { dials: { rows: [string, string, number, number, number][] }; daily: { cols: string[]; rows: unknown[][] }; dims: { customers: { name: string; kind: string }[]; reps: string[]; lines: { number: string }[] } };

function table(title: string, v: Totals): number {
  const lines: [string, number, number][] = [
    ["Total dials", EXPECTED.dials, v.dials],
    ["Connects", EXPECTED.connects, v.connects],
    ["Meaningful conversations", EXPECTED.meaningful, v.meaningful],
    ["MQLs", EXPECTED.mql, v.mql],
    ["  MQLs over 90 sec", EXPECTED.mqlOver90, v.mqlOver90],
    ["  MQLs 90 sec or less", EXPECTED.mqlUnder90, v.mql - v.mqlOver90],
    ...Object.entries(EXPECTED.byClient).map(([c, n]): [string, number, number] => [`Dials: ${c}`, n, v.byClient[c] ?? 0]),
    ["Dials on the Sep 10 shift", EXPECTED.sep10, v.sep10],
  ];
  console.log(`\n${title}\n`);
  console.log("check".padEnd(30), "expected".padStart(9), "actual".padStart(9), "difference");
  let bad = 0;
  for (const [name, want, got] of lines) {
    const ok = want === got;
    if (!ok) bad++;
    console.log(name.padEnd(30), String(want).padStart(9), String(got).padStart(9), ok ? "  ok" : `  ${got - want > 0 ? "+" : ""}${got - want}  <-- differs`);
  }
  console.log(bad ? `\n${bad} of ${lines.length} checks differ.` : `\nAll ${lines.length} checks match.`);
  return bad;
}

async function everythingTheApiHas(): Promise<{ totals: Totals; rows: Row[] }> {
  const connect = CONNECT_KEYS.map((k) => `d_${k}`).join(" + ");
  const rows = await db.$queryRawUnsafe<Row[]>(`
    SELECT c.name AS client, r.name AS rep, d.line_no10 AS line, to_char(d.shift_date,'YYYY-MM-DD') AS shift,
           sum(d.calls)::int AS calls, sum(${connect})::int AS connects, sum(d.meaningful)::int AS meaningful, sum(d.d_mql)::int AS mql, sum(d.mql_over_90)::int AS mql_over_90
    FROM daily_rollups d JOIN clients c ON c.id = d.client_id JOIN representatives r ON r.id = d.representative_id
    WHERE c.kind = 'CUSTOMER' AND d.shift_date BETWEEN '${FROM}' AND '${TO}'
    GROUP BY 1, 2, 3, 4`);
  const sum = (f: (r: Row) => number, p: (r: Row) => boolean = () => true) => rows.filter(p).reduce((a, r) => a + f(r), 0);
  const totals: Totals = {
    dials: sum((r) => r.calls), connects: sum((r) => r.connects), meaningful: sum((r) => r.meaningful), mql: sum((r) => r.mql),
    mqlOver90: sum((r) => r.mql_over_90), byClient: {}, sep10: sum((r) => r.calls, (r) => r.shift === "2026-09-10"),
  };
  for (const r of rows) totals.byClient[r.client] = (totals.byClient[r.client] ?? 0) + r.calls;
  return { totals, rows };
}

/**
 * The same totals, but only for calls the prototype's workbook also has: same IST time and duration, and the same client
 * and Representative. Anything left over in the first table is then a call the workbook does not contain.
 */
async function onlyInWorkbook(seed: Seed): Promise<Totals> {
  const left = new Map<string, number>();
  for (const d of seed.dials.rows) {
    const k = `${d[0]} ${d[1].slice(0, 8)} ${d[4]} ${seed.dims.customers[d[3]].name} ${seed.dims.reps[d[2]]}`;
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  const calls = await db.$queryRawUnsafe<{ client: string; rep: string; dk: string | null; dur: number; shift: string; ist: string }[]>(`
    SELECT cl.name AS client, r.name AS rep, c.disposition_key AS dk, c.duration_sec AS dur, to_char(c.shift_date,'YYYY-MM-DD') AS shift,
           to_char((c.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') AS ist
    FROM calls c JOIN call_attribution a ON a.call_id = c.id JOIN clients cl ON cl.id = a.client_id JOIN representatives r ON r.id = a.representative_id
    WHERE a.status = 'CLIENT' AND cl.kind = 'CUSTOMER' AND c.shift_date BETWEEN '${FROM}' AND '${TO}'`);
  const t: Totals = { dials: 0, connects: 0, meaningful: 0, mql: 0, mqlOver90: 0, byClient: {}, sep10: 0 };
  for (const c of calls) {
    const k = `${c.ist} ${c.dur} ${c.client} ${c.rep}`;
    if (!(left.get(k) ?? 0)) continue;
    left.set(k, left.get(k)! - 1);
    t.dials++;
    t.byClient[c.client] = (t.byClient[c.client] ?? 0) + 1;
    if (isConnect(c.dk)) t.connects++;
    if (isMeaningful(c.dk, c.dur)) t.meaningful++;
    if (c.dk === "mql") t.mql++;
    if (isMqlOver90(c.dk, c.dur)) t.mqlOver90++;
    if (c.shift === "2026-09-10") t.sep10++;
  }
  return t;
}

/** Where our daily counts differ from the prototype's, by day, client, Representative and phone line. */
function compareWithPrototype(seed: Seed, ours: Row[]) {
  const col = (n: string) => seed.daily.cols.indexOf(n);
  const key = (shift: string, client: string, rep: string, line: string | null) => `${shift} | ${client} | ${rep} | …${(line ?? "").slice(-4)}`;
  const proto = new Map<string, number>(), mine = new Map<string, number>();
  for (const r of seed.daily.rows) {
    const client = seed.dims.customers[r[col("customer")] as number];
    if (client.kind !== "customer") continue;
    const k = key(r[col("date")] as string, client.name, seed.dims.reps[r[col("rep")] as number], last10(seed.dims.lines[r[col("line")] as number].number));
    proto.set(k, (proto.get(k) ?? 0) + (r[col("calls")] as number));
  }
  for (const r of ours) mine.set(key(r.shift, r.client, r.rep, r.line), (mine.get(key(r.shift, r.client, r.rep, r.line)) ?? 0) + r.calls);
  const diffs = [...new Set([...proto.keys(), ...mine.keys()])].map((k) => [k, mine.get(k) ?? 0, proto.get(k) ?? 0] as const).filter(([, a, b]) => a !== b);
  console.log(`\nDay by day, against the prototype's own counts: ${proto.size} groups in the prototype, ${mine.size} in ours, ${diffs.length} differ.`);
  console.log("(A call on a line the sheet does not list is counted under the Representative's own listed line by the prototype, so line numbers can differ while the client total agrees.)");
}

async function main() {
  const { totals, rows } = await everythingTheApiHas();
  let bad = table(`1. Everything the API has. Shift days ${FROM} to ${TO}, client lines only`, totals);
  const html = process.argv[2];
  if (html) {
    const seed = JSON.parse(readFileSync(html, "utf8").match(/<script type="application\/json" id="seed-data">([\s\S]*?)<\/script>/)![1]) as Seed;
    bad += table("2. Counting only the calls the prototype's workbook also contains", await onlyInWorkbook(seed));
    compareWithPrototype(seed, rows);
  }
  await db.$disconnect();
  process.exit(bad ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
