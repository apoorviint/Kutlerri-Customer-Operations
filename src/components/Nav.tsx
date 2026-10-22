import Link from "next/link";
import { getSession } from "@/lib/session";
import { logout } from "@/app/login/actions";

export default async function Nav() {
  const s = await getSession();
  return (
    <header className="flex items-center gap-4 border-b bg-white px-6 py-3">
      <span className="font-semibold">Customer Ops</span>
      <Link href="/dashboard" className="text-sm hover:underline">Dashboard</Link>
      {s?.role === "ADMIN" && <Link href="/admin" className="text-sm hover:underline">Admin</Link>}
      <span className="ml-auto text-sm text-slate-500">{s?.email}</span>
      <form action={logout}><button className="text-sm underline">Sign out</button></form>
    </header>
  );
}
