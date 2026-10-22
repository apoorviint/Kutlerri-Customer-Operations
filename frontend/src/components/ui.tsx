"use client";

import { useEffect, useRef, useState } from "react";

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** Loading, error and ready states for anything fetched. While newer data loads, the old data stays on screen, dimmed. */
export function Async<T>({ state, children }: { state: State<T>; children: (data: T) => React.ReactNode }) {
  if (state.error && !state.data) return <p className="problem" role="alert">{state.error}</p>;
  if (!state.data) return <div className="empty" role="status">Loading…</div>;
  return (
    <div className={state.loading ? "busy" : undefined} aria-busy={state.loading}>
      {state.error && <p className="problem" role="alert">{state.error}</p>}
      {children(state.data)}
    </div>
  );
}

export const Dot = ({ color }: { color: string }) => (
  <span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color, marginRight: 8 }} />
);

export const Chevron = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

/**
 * A panel that slides in from the right. Focus moves into it and stays inside while it is open, Escape closes it,
 * and focus goes back to the button that opened it.
 */
export function Drawer({ titleId, title, chips, sub, onClose, children }: {
  titleId: string; title: string; chips?: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  const sheet = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !sheet.current) return;
      const f = [...sheet.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="drawer">
      <div className="scrim" onClick={onClose} />
      <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={sheet}>
        <header className="phead">
          <div>
            <div className="ptop"><h2 id={titleId}>{title}</h2>{chips}</div>
            {sub && <div className="psub">{sub}</div>}
          </div>
          <button className="pclose" ref={close} onClick={onClose} aria-label="Close profile">✕</button>
        </header>
        <div className="pbody">{children}</div>
      </aside>
    </div>
  );
}

/** The chips under a profile's name: pick which clients (or Representatives) it covers. Nothing picked means all. */
export function ChipPicker({ label, options, selected, onChange, dot }: {
  label: string; options: { id: number; name: string }[]; selected: number[]; onChange: (ids: number[]) => void; dot?: (name: string) => string;
}) {
  if (options.length <= 1) {
    return <div className="pchips">{options.map((o) => <span key={o.id} className="pchip static">{dot && <i style={{ background: dot(o.name) }} />}{o.name}</span>)}</div>;
  }
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="pchips" role="group" aria-label={label}>
      <button className="pchip" aria-pressed={selected.length === 0} onClick={() => onChange([])}>All</button>
      {options.map((o) => (
        <button key={o.id} className="pchip" aria-pressed={selected.includes(o.id)} onClick={() => toggle(o.id)}>
          {dot && <i style={{ background: dot(o.name) }} />}{o.name}
        </button>
      ))}
    </div>
  );
}

/** Waits until typing pauses, so a search is not sent on every key. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
