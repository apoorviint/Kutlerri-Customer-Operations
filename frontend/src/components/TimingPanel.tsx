"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { addDays, clock, dayName, dur, fShort, hhmm, isoWeek, n0, tick, when } from "@/lib/format";
import { useFilters } from "@/lib/filters";
import { useApi } from "@/lib/hooks";
import type { RepDay, TimingDay, TimingDays, TimingSettings, TimingWeek } from "@/lib/types";
import { Async } from "./ui";

type Mode = "day" | "week";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Call timing and breaks. Daily: every Representative who dialed on one shift day, on a shared clock.
 * Weekly: one Representative, one strip per day. Times are IST; a time past 12 AM is still the same shift.
 */
export default function TimingPanel() {
  const { qs } = useFilters();
  const days = useApi<TimingDays>(`/timing/days?${qs}`);
  const [mode, setMode] = useState<Mode>("day");
  const [day, setDay] = useState("");
  const [week, setWeek] = useState("");
  const [repId, setRepId] = useState(0);

  const list = days.data?.days ?? [];
  const weeks = days.data?.weeks ?? [];
  // keep the pickers on something that exists in the selected dates
  useEffect(() => { if (list.length && !list.includes(day)) setDay(list[list.length - 1]); }, [list, day]);
  useEffect(() => { if (weeks.length && !weeks.some((w) => w.monday === week)) setWeek(weeks[weeks.length - 1].monday); }, [weeks, week]);
  const reps = useMemo(() => weeks.find((w) => w.monday === week)?.representatives ?? [], [weeks, week]);
  useEffect(() => { if (reps.length && !reps.some((r) => r.id === repId)) setRepId(reps[0].id); }, [reps, repId]);

  const modeButtons = (
    <div className="tm-mode" role="group" aria-label="View">
      <button className={mode === "day" ? "on" : ""} aria-pressed={mode === "day"} onClick={() => setMode("day")}>Daily</button>
      <button className={mode === "week" ? "on" : ""} aria-pressed={mode === "week"} onClick={() => setMode("week")}>Weekly</button>
    </div>
  );

  return (
    <section className="panel" id="timing">
      <header><h3>Call timing and breaks</h3></header>
      <Async state={days}>
        {() =>
          !list.length ? (
            <><div className="tm-ctl">{modeButtons}</div><div className="empty">No calls in the selected dates.</div></>
          ) : mode === "day" ? (
            <DayView controls={modeButtons} list={list} day={day} setDay={setDay} />
          ) : (
            <WeekView controls={modeButtons} weeks={weeks} week={week} setWeek={setWeek} reps={reps} repId={repId} setRepId={setRepId} />
          )
        }
      </Async>
    </section>
  );
}

const Schedules = ({ t }: { t: TimingSettings }) => (
  <div className="tm-sched">
    {Object.entries(t.clients).map(([name, s]) => <span key={name}>{name}: starts {hhmm(s.start)}, break {hhmm(s.breakStart)} – {hhmm(s.breakEnd)}</span>)}
    <span>{Object.keys(t.clients).length ? "All other clients" : "Every client"}: start {hhmm(t.default.start)}, break {hhmm(t.default.breakStart)} – {hhmm(t.default.breakEnd)}</span>
  </div>
);

const Legend = () => (
  <div className="tm-legend">
    <span><i style={{ background: "var(--primary)" }} />Calling</span>
    <span><i style={{ background: "color-mix(in srgb,var(--muted) 14%,transparent)" }} />Scheduled break</span>
    <span><i style={{ background: "rgba(245,158,11,.20)", border: "1px solid rgba(245,158,11,.6)" }} />Actual break</span>
  </div>
);

/** The shared clock: from 6 PM (or earlier) to 4 AM (or later), in whole hours. */
function axisOf(days: RepDay[]) {
  const lo = Math.min(18 * 60, Math.floor(Math.min(...days.map((d) => d.first)) / 60) * 60);
  const hi = Math.max(28 * 60, Math.ceil(Math.max(...days.map((d) => d.last)) / 60) * 60);
  return { lo, hi, hrs: (hi - lo) / 60 };
}

function Ticks({ lo, hrs }: { lo: number; hrs: number }) {
  return <div className="tm-ticks">{Array.from({ length: hrs + 1 }, (_, i) => <span key={i} style={{ left: `${((i / hrs) * 100).toFixed(2)}%` }}>{tick(lo / 60 + i)}</span>)}</div>;
}

function Track({ d, lo, hi, hrs, label, className }: { d: RepDay; lo: number; hi: number; hrs: number; label: string; className?: string }) {
  const pc = (t: number) => (((t - lo) / (hi - lo)) * 100).toFixed(2);
  const s = d.schedule;
  return (
    <div className={`tm-track ${className ?? ""}`} style={{ ["--h" as string]: hrs }}>
      <div className="tm-win" style={{ left: `${pc(s.breakStart)}%`, width: `${((s.breakEnd - s.breakStart) / (hi - lo)) * 100}%` }} title={`Scheduled break ${clock(s.breakStart)} – ${clock(s.breakEnd)}`} />
      {d.main && (
        <div className="tm-gap" style={{ left: `${pc(d.main.from)}%`, width: `${(d.main.len / (hi - lo)) * 100}%` }} title={`${label}break ${clock(d.main.from)} – ${clock(d.main.to)} (${dur(d.main.len)})`}>
          {d.main.len / (hi - lo) > 0.075 && <span>{dur(d.main.len)}</span>}
        </div>
      )}
      {d.blocks.map((b, i) => (
        <div key={i} className="tm-blk" style={{ left: `${pc(b.s)}%`, width: `${Math.max(0, ((b.e - b.s) / (hi - lo)) * 100)}%` }}
          title={`${label}${clock(b.s)} – ${clock(b.e)} · ${d.clients.find((c) => c.id === b.clientId)?.name ?? ""} · ${b.n} call${b.n === 1 ? "" : "s"}`} />
      ))}
    </div>
  );
}

/** First call, break start and return: the time, and how it compares with the schedule (flagged when late). */
function Compare({ t, delta, grace, flag }: { t: number; delta: number; grace: number; flag: boolean }) {
  return <td>{clock(t)}<small className={flag && delta > grace ? "neg" : ""}>{when(delta, grace)}</small></td>;
}

function TimingRow({ d, grace, nameCell, clientsCell }: { d: RepDay; grace: number; nameCell: React.ReactNode; clientsCell: React.ReactNode }) {
  const m = d.main, allowed = d.schedule.breakEnd - d.schedule.breakStart, dash = <td className="na">–</td>;
  return (
    <tr>
      <td className="name">{nameCell}</td><td className="txt">{clientsCell}</td>
      <td>{n0(d.calls)}</td>
      <Compare t={d.first} delta={d.firstDelta} grace={grace} flag />
      <td>{clock(d.last)}</td>
      {m ? (
        <>
          <Compare t={m.from} delta={d.breakStartDelta!} grace={grace} flag={false} />
          <Compare t={m.to} delta={d.returnDelta!} grace={grace} flag />
          <td>{dur(m.len)}<small className={d.breakLenDelta! > grace ? "neg" : ""}>{Math.abs(d.breakLenDelta!) <= grace ? `within ${allowed}m` : `${Math.abs(Math.round(d.breakLenDelta!))}m ${d.breakLenDelta! > 0 ? "over" : "under"} ${allowed}m`}</small></td>
          <td>{n0(m.before)}</td><td>{n0(m.after)}</td>
        </>
      ) : <>{dash}{dash}{dash}{dash}{dash}</>}
      {d.other.length ? (
        <td title={d.other.map((g) => `${clock(g.from)} – ${clock(g.to)} (${dur(g.len)})`).join("\n")}>{d.other.length}<small>{dur(d.other.reduce((n, g) => n + g.len, 0))} total</small></td>
      ) : dash}
    </tr>
  );
}

const Head = ({ first, gap }: { first: string; gap: number }) => (
  <thead>
    <tr>
      <th className="left">{first}</th><th className="left">Client</th><th>Calls</th><th>First call</th><th>Last call</th>
      <th>Break starts</th><th>Back on calls</th><th>Break length</th><th>Before break</th><th>After break</th>
      <th title={`Other pauses of ${gap} minutes or more`}>Other pauses</th>
    </tr>
  </thead>
);

const clientsOf = (d: RepDay) => <>{d.clients[0]?.name}{d.clients.length > 1 && <small> +{d.clients.length - 1} more</small>}</>;

function DayView({ controls, list, day, setDay }: { controls: React.ReactNode; list: string[]; day: string; setDay: (d: string) => void }) {
  const state = useApi<TimingDay>(day ? `/timing/day?date=${day}` : null);
  const idx = list.indexOf(day);
  return (
    <>
      <div className="tm-ctl">
        {controls}
        <button aria-label="Previous day" disabled={idx <= 0} onClick={() => setDay(list[idx - 1])}>◀</button>
        <select aria-label="Choose a day" value={day} onChange={(e) => setDay(e.target.value)}>{list.map((d) => <option key={d} value={d}>{dayName(d)}</option>)}</select>
        <button aria-label="Next day" disabled={idx < 0 || idx === list.length - 1} onClick={() => setDay(list[idx + 1])}>▶</button>
      </div>
      <Async state={state}>
        {(t) => {
          if (!t.reps.length) return <div className="empty">No calls on this day.</div>;
          const { lo, hi, hrs } = axisOf(t.reps), s = t.summary, g = t.settings.graceMinutes;
          return (
            <>
              <Schedules t={t.settings} />
              <div className="tm-sum">
                <span><b>{s.dialing}</b> representative{s.dialing === 1 ? "" : "s"} dialing</span>
                {s.breaks ? <><span>Avg break <b>{dur(s.avgBreak!)}</b></span><span>Break over limit <b>{s.breakOver}</b></span><span>Back late from break <b>{s.backLate}</b></span></> : <span>No breaks found</span>}
              </div>
              <div className="tm-axis"><div /><Ticks lo={lo} hrs={hrs} /></div>
              {t.reps.map((d) => (
                <div className="tm-row" key={d.representativeId}>
                  <div className="tm-lab" title={d.name}><b>{d.name}</b><small>{d.clients[0]?.name}{d.clients.length > 1 ? ` +${d.clients.length - 1}` : ""}</small></div>
                  <Track d={d} lo={lo} hi={hi} hrs={hrs} label="" />
                </div>
              ))}
              <Legend />
              <div className="tablewrap">
                <table>
                  <Head first="Name" gap={t.settings.gapMinutes} />
                  <tbody>{t.reps.map((d) => <TimingRow key={d.representativeId} d={d} grace={g} nameCell={d.name} clientsCell={clientsOf(d)} />)}</tbody>
                </table>
              </div>
              <p className="tm-note">Times are IST. A shift runs from the evening into the early morning, so a call after midnight belongs to the day the shift started.</p>
            </>
          );
        }}
      </Async>
    </>
  );
}

function WeekView({ controls, weeks, week, setWeek, reps, repId, setRepId }: {
  controls: React.ReactNode; weeks: TimingDays["weeks"]; week: string; setWeek: (w: string) => void;
  reps: { id: number; name: string; dials: number }[]; repId: number; setRepId: (n: number) => void;
}) {
  const state = useApi<TimingWeek>(week && repId ? `/timing/week?week=${week}&representative=${repId}` : null);
  const wi = weeks.findIndex((w) => w.monday === week);
  return (
    <>
      <div className="tm-ctl">
        {controls}
        <button aria-label="Previous week" disabled={wi <= 0} onClick={() => setWeek(weeks[wi - 1].monday)}>◀</button>
        <select aria-label="Choose a week" value={week} onChange={(e) => setWeek(e.target.value)}>
          {weeks.map((w) => <option key={w.monday} value={w.monday}>Week {isoWeek(w.monday)} · {fShort(w.monday)} – {fShort(addDays(w.monday, 6))}</option>)}
        </select>
        <button aria-label="Next week" disabled={wi < 0 || wi === weeks.length - 1} onClick={() => setWeek(weeks[wi + 1].monday)}>▶</button>
        <select aria-label="Choose a representative" value={repId} onChange={(e) => setRepId(Number(e.target.value))}>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      </div>
      <Async state={state}>
        {(t) => {
          const worked = t.days.filter((d) => d.day).map((d) => d.day!);
          if (!worked.length) return <div className="empty">No calls this week.</div>;
          const { lo, hi, hrs } = axisOf(worked), s = t.summary, g = t.settings.graceMinutes;
          return (
            <>
              <Schedules t={t.settings} />
              <div className="tm-sum">
                <span><b>{s.daysDialed}</b> day{s.daysDialed === 1 ? "" : "s"} dialed</span><span><b>{n0(s.dials)}</b> dials</span>
                {s.breaks ? <><span>Avg break <b>{dur(s.avgBreak!)}</b></span><span>Break over limit <b>{s.breakOver}</b></span></> : <span>No breaks found</span>}
              </div>
              <div className="tm-axis tw-axis"><Ticks lo={lo} hrs={hrs} /></div>
              {t.days.map(({ date, day }) => (
                <div className="tw-row" key={date}>
                  <div className="tw-day" title={dayName(date)}>{DOW[new Date(`${date}T00:00:00`).getDay()]} {Number(date.slice(8))}</div>
                  {day ? <Track d={day} lo={lo} hi={hi} hrs={hrs} label={`${dayName(date)} · `} className="tw-track" /> : <div className="tm-track tw-track" style={{ ["--h" as string]: hrs }} />}
                </div>
              ))}
              <Legend />
              <div className="tablewrap">
                <table>
                  <Head first="Day" gap={t.settings.gapMinutes} />
                  <tbody>
                    {t.days.map(({ date, day }) => (
                      <Fragment key={date}>
                        {day ? <TimingRow d={day} grace={g} nameCell={dayName(date)} clientsCell={clientsOf(day)} />
                          : <tr><td className="name">{dayName(date)}</td><td className="na" colSpan={10}>Did not dial</td></tr>}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tm-note">Times are IST. Each strip is one shift day on the same clock.</p>
            </>
          );
        }}
      </Async>
    </>
  );
}
