"use client";

import { useState } from "react";
import ClientView from "@/components/ClientView";
import Header from "@/components/Header";
import OverviewView from "@/components/OverviewView";
import RepView from "@/components/RepView";
import { FiltersProvider } from "@/lib/filters";

type Tab = "overview" | "ops" | "client";
const TABS: [Tab, string][] = [["overview", "Overview"], ["ops", "Representative View"], ["client", "Client View"]];

export default function Dashboard() {
  // the Overview is the page you land on, every time
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <FiltersProvider>
      <Header />
      <main className="wrap">
        <div className="choices compact" role="group" aria-label="Choose a dashboard">
          {TABS.map(([k, label]) => <button key={k} className="big" aria-pressed={tab === k} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {tab === "overview" && <OverviewView />}
        {tab === "ops" && <RepView />}
        {tab === "client" && <ClientView />}
      </main>
    </FiltersProvider>
  );
}
