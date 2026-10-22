"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";

type Options = { google: boolean; password: boolean; domain: string | null };

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<Options | null>(null);

  useEffect(() => {
    // Google sends people back here with ?error=… when sign-in is refused (wrong domain, switched off, cancelled)
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setError(e);
    api<Options>("/auth/config").then(setOptions).catch(() => setOptions({ google: false, password: true, domain: null }));
  }, []);

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
        {options?.google && (
          <a className="go google" href="/api/auth/google">Sign in with Google{options.domain ? ` (@${options.domain})` : ""}</a>
        )}
        {options?.google && options.password && <p className="or">or</p>}
        {(options === null || options.password) && (
          <>
            <input name="email" type="email" required placeholder="Email" autoComplete="username" aria-label="Email" />
            <input name="password" type="password" required placeholder="Password" autoComplete="current-password" aria-label="Password" />
            <button className="go" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </>
        )}
        {error && <p role="alert" className="problem">{error}</p>}
      </form>
    </main>
  );
}
