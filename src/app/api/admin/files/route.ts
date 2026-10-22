import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { deleteRepoFile } from "@/lib/github";

export async function DELETE(req: Request) {
  const s = await getSession();
  if (s?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const name = new URL(req.url).searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  try {
    await deleteRepoFile(name, `Delete ${name} via dashboard (${s.email})`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Delete failed" }, { status: 502 });
  }
}
