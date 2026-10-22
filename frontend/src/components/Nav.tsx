"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type Me } from "@/lib/api";

export default function Nav({ me }: { me: Me | null }) {
  const router = useRouter();
  const path = usePathname();

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  const link = (href: string, label: string) => (
    <Link href={href} className={`text-sm hover:underline ${path.startsWith(href) ? "font-semibold" : "text-ink-2"}`}>
      {label}
    </Link>
  );

  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <span className="font-semibold">Customer Ops</span>
      {link("/dashboard", "Dashboard")}
      {me?.role === "ADMIN" && link("/admin", "Admin")}
      <span className="ml-auto text-sm text-ink-2">{me?.email}</span>
      <button onClick={logout} className="text-sm underline">Sign out</button>
    </header>
  );
}
