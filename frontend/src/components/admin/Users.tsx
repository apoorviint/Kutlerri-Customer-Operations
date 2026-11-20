"use client";

import { useState } from "react";
import { Async } from "@/components/ui";
import { api } from "@/lib/api";
import { useApi, useMe } from "@/lib/hooks";
import { ErrorBox, Notice, Table, useAction, when } from "./parts";

type User = { id: string; email: string; role: "ADMIN" | "VIEWER" | "LIMITED"; active: boolean; createdAt: string; lastLoginAt: string | null; hasPassword: boolean };
const json = (body: unknown): RequestInit => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export default function Users() {
  const [tick, setTick] = useState(0);
  const users = useApi<User[]>(`/admin/users?x=${tick}`);
  const me = useMe();
  const act = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"VIEWER" | "ADMIN">("VIEWER");
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState({ email: "", password: "", role: "VIEWER" });

  async function update(id: string, body: { role?: string; active?: boolean }) {
    const r = await act.run(() => api(`/admin/users/${id}`, { method: "PUT", ...json(body) }));
    if (r) { setMsg("Saved."); setTick((t) => t + 1); }
  }
  async function add() {
    const r = await act.run(() => api("/admin/users", { method: "POST", ...json({ email, role }) }));
    if (r) { setEmail(""); setMsg("Added. They can now sign in with Google."); setTick((t) => t + 1); }
  }

  async function setPassword() {
    const r = await act.run(() => api("/admin/users/password", { method: "POST", ...json(pw) }));
    if (r) { setPw({ email: "", password: "", role: pw.role }); setMsg("Saved. They can sign in with that email and password."); setTick((t) => t + 1); }
  }

  return (
    <>
      <section className="panel">
        <header><h3>People who can sign in</h3></header>
        <p className="na">
          Anyone with a company Google account can sign in and arrives as a <b>viewer</b> (the dashboards). Make someone an <b>administrator</b> to let them use this console.
          Switching someone off signs them out within a minute. You cannot remove your own access, and one active administrator always remains.
        </p>
        <ErrorBox error={act.error} />
        {msg && <Notice kind="ok">{msg}</Notice>}
        <Async state={users}>
          {(list) => (
            <Table head={["Email", "Role", "Status", "Last sign-in", ""]} rows={list.map((u) => [
              u.email + (u.email === me?.email ? " (you)" : ""),
              <select key="r" aria-label={`Role for ${u.email}`} value={u.role} disabled={act.busy || u.email === me?.email} onChange={(e) => update(u.id, { role: e.target.value })}>
                <option value="VIEWER">Viewer</option><option value="LIMITED">Limited (no Kutlerri revenue)</option><option value="ADMIN">Administrator</option>
              </select>,
              <span key="s" className={`pill ${u.active ? "ok" : "na"}`}>{u.active ? "active" : "switched off"}</span>,
              when(u.lastLoginAt),
              u.email === me?.email ? "" : <button key="b" className="btn small" disabled={act.busy} onClick={() => update(u.id, { active: !u.active })}>{u.active ? "Switch off" : "Switch on"}</button>,
            ])} />
          )}
        </Async>
      </section>
      <section className="panel">
        <header><h3>Add someone before they sign in</h3></header>
        <div className="adm-form">
          <label>Company email<input aria-label="New user email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></label>
          <label>Role<select aria-label="New user role" value={role} onChange={(e) => setRole(e.target.value as "VIEWER" | "ADMIN")}><option value="VIEWER">Viewer</option><option value="ADMIN">Administrator</option></select></label>
          <button className="btn" disabled={!email.trim() || act.busy} onClick={add}>Add</button>
        </div>
      </section>
      <section className="panel">
        <header><h3>Give someone a password</h3></header>
        <p className="na">For someone who signs in with an email and password instead of Google. A new email is created, and for an existing one the password is replaced. <b>Limited</b> is a viewer who never sees the admin console or Kutlerri&rsquo;s revenue.</p>
        <div className="adm-form">
          <label>Email<input aria-label="Email for the password" type="email" value={pw.email} onChange={(e) => setPw({ ...pw, email: e.target.value })} placeholder="name@company.com" autoComplete="off" /></label>
          <label>Password<input aria-label="New password" type="password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} placeholder="8 or more characters" autoComplete="new-password" /></label>
          <label>Role<select aria-label="Role for the password" value={pw.role} onChange={(e) => setPw({ ...pw, role: e.target.value })}><option value="VIEWER">Viewer</option><option value="LIMITED">Limited (no Kutlerri revenue)</option><option value="ADMIN">Administrator</option></select></label>
          <button className="btn" disabled={!pw.email.trim() || pw.password.length < 8 || act.busy} onClick={setPassword}>Save password</button>
        </div>
      </section>
    </>
  );
}
