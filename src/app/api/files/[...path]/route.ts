import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readBlob } from "@/lib/github";

// /api/files/<id> streams a stored file to any signed-in user (middleware enforces login).
export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const f = await db.uploadedFile.findUnique({ where: { id: path[0] } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await readBlob(f.sha);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": f.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
