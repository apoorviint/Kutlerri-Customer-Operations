"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api<Me>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <h1>Customer Success Operations Dashboard</h1>
        <input name="email" type="email" required placeholder="Email" autoComplete="username" aria-label="Email" />
        <input name="password" type="password" required placeholder="Password" autoComplete="current-password" aria-label="Password" />
        {error && <p role="alert" className="problem">{error}</p>}
        <button className="go" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
