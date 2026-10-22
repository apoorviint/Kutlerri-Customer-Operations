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
      const me = await api<Me>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.get("email"), password: f.get("password") }),
      });
      router.replace(me.role === "ADMIN" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6">
        <h1 className="text-xl font-semibold">Customer Operations</h1>
        <input name="email" type="email" required placeholder="Email" autoComplete="username"
          className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        <input name="password" type="password" required placeholder="Password" autoComplete="current-password"
          className="w-full rounded-md border border-line bg-transparent px-3 py-2" />
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-ink py-2 text-surface disabled:opacity-60">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
