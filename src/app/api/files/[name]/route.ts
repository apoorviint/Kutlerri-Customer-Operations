import { NextResponse } from "next/server";
import { readBuiltFile } from "@/lib/files";

// Serves a file from the current build to any signed-in user (middleware enforces login).
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await readBuiltFile(decodeURIComponent(name));
  if (!body) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
