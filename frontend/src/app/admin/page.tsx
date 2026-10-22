"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Assignments from "@/components/admin/Assignments";
import Billing from "@/components/admin/Billing";
import DataQuality from "@/components/admin/DataQuality";
import { Audit, Jobs } from "@/components/admin/JobsAudit";
import Mappings from "@/components/admin/Mappings";
import Prospects from "@/components/admin/Prospects";
import Users from "@/components/admin/Users";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";

type Tab = "quality" | "assignments" | "prospects" | "billing" | "mappings" | "users" | "jobs" | "audit";
const TABS: [Tab, string][] = [
  ["quality", "Data quality"], ["assignments", "Who dialed for whom"], ["prospects", "Prospect databases"], ["billing", "Billing"],
  ["mappings", "Mappings & settings"], ["users", "People"], ["jobs", "Jobs"], ["audit", "Audit log"],
];

export default function Admin() {
  const me = useMe();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("quality");

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return (
    <>
      <header className="top">
        <h1 className="title">Admin console</h1>
        <div className="datefilter">
          <span className="who-am-i">
            <Link href="/dashboard" className="adminlink">← Dashboard</Link>
            {me?.email}{me && <button onClick={signOut}>Sign out</button>}
          </span>
        </div>
      </header>
      <main className="wrap adm">
        {me && me.role !== "ADMIN" ? (
          <p className="problem" role="alert">The admin console is for administrators only.</p>
        ) : (
          <>
            <div className="adm-tabs" role="tablist" aria-label="Admin sections">
              {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>{label}</button>)}
            </div>
            <div className="view">
              {tab === "quality" && <DataQuality />}
              {tab === "assignments" && <Assignments />}
              {tab === "prospects" && <Prospects />}
              {tab === "billing" && <Billing />}
              {tab === "mappings" && <Mappings />}
              {tab === "users" && <Users />}
              {tab === "jobs" && <Jobs />}
              {tab === "audit" && <Audit />}
            </div>
          </>
        )}
      </main>
    </>
  );
}
