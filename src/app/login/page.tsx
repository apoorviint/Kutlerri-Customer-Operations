"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Customer Operations</h1>
        <input name="email" type="email" required placeholder="Email" autoComplete="username"
          className="w-full rounded-md border px-3 py-2" />
        <input name="password" type="password" required placeholder="Password" autoComplete="current-password"
          className="w-full rounded-md border px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="w-full rounded-md bg-slate-900 py-2 text-white disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
