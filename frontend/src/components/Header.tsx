"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useFilters } from "@/lib/filters";
import type { Preset } from "@/lib/format";
import { useMe } from "@/lib/hooks";

/** The title and the date range every tab uses. Days are shift days (5 PM to 5 PM IST). */
export default function Header() {
  const { from, to, preset, setFrom, setTo, setPreset } = useFilters();
  const me = useMe();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // start from the saved choice, else from the device setting
  useEffect(() => {
    let t: string | null = null;
    try { t = localStorage.getItem("theme"); } catch {}
    const v = t === "dark" || t === "light" ? t : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(v);
    document.documentElement.dataset.theme = v;
  }, []);

  function switchTheme() {
    const v = theme === "dark" ? "light" : "dark";
    setTheme(v);
    document.documentElement.dataset.theme = v;
    try { localStorage.setItem("theme", v); } catch {}
  }

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return (
    <header className="top">
      <div className="brand">
        <img className="logo" src="/kutlerri-logo.png" alt="Kutlerri.ai" width={171} height={34} />
        <h1 className="title">Customer Success Operations Dashboard</h1>
      </div>
      <div className="datefilter" role="group" aria-label="Date range">
        <span className="name">DATE RANGE</span>
        <select className="preset" aria-label="Quick period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          <option value="custom">Custom</option>
          <option value="last_week">Last week</option>
          <option value="this_week">This week</option>
          <option value="last_month">Last month</option>
          <option value="this_month">This month</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
        </select>
        <div className="range">
          <label htmlFor="dateFrom">From</label>
          <input type="date" id="dateFrom" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          <span className="sep">–</span>
          <label htmlFor="dateTo">To</label>
          <input type="date" id="dateTo" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="themebtn" onClick={switchTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
        {me && (
          <span className="who-am-i">
            {me.role === "ADMIN" && <Link href="/admin" className="adminlink">Admin console</Link>}
            <button onClick={signOut}>Sign out</button>
          </span>
        )}
      </div>
    </header>
  );
}
