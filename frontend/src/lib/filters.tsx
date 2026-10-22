"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { presetRange, type Preset } from "./format";
import { useApi } from "./hooks";
import type { Meta, Range } from "./types";

type Filters = {
  meta: Meta;
  from: string; to: string; preset: Preset;
  setFrom: (v: string) => void; setTo: (v: string) => void; setPreset: (p: Preset) => void;
  range: Range;
  /** `?from=…&to=…` for the data requests */
  qs: string;
};

const Ctx = createContext<Filters | null>(null);
export const useFilters = () => {
  const f = useContext(Ctx);
  if (!f) throw new Error("useFilters needs the FiltersProvider");
  return f;
};

/** The date range every screen uses. It starts on everything there is data for, like the prototype. */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const { data: meta, error } = useApi<Meta>("/meta");
  const [from, setFromRaw] = useState("");
  const [to, setToRaw] = useState("");
  const [preset, setPreset] = useState<Preset>("custom");

  useEffect(() => {
    if (meta && !from) { setFromRaw(meta.dateMin); setToRaw(meta.dateMax); }
  }, [meta, from]);

  const value = useMemo<Filters | null>(() => {
    if (!meta || !from || !to) return null;
    return {
      meta, from, to, preset,
      setFrom: (v) => { if (!v) return; setFromRaw(v); if (v > to) setToRaw(v); setPreset("custom"); },
      setTo: (v) => { if (!v) return; setToRaw(v); if (v < from) setFromRaw(v); setPreset("custom"); },
      setPreset: (p) => {
        setPreset(p);
        const r = presetRange(p, meta.today);
        if (r) { setFromRaw(r[0]); setToRaw(r[1]); } // "Custom" leaves the dates as they are
      },
      range: { from, to },
      qs: `from=${from}&to=${to}`,
    };
  }, [meta, from, to, preset]);

  if (error) return <main className="wrap"><p className="problem" role="alert">Could not load the dashboard: {error}</p></main>;
  if (!value) return <main className="wrap"><p className="empty">Loading…</p></main>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
