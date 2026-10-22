import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { runSync } from "@/lib/sync";

// Callable by an admin session, or by a scheduler sending `Authorization: Bearer $CRON_SECRET`.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const cronOk = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!cronOk) {
    const s = await getSession();
    if (s?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runSync();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
