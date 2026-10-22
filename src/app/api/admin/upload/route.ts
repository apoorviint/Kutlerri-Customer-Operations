import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { commitFile } from "@/lib/github";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = /\.(csv|xlsx?|pdf|png|jpe?g|txt|json|docx?)$/i;

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const file = (await req.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES)
    return NextResponse.json({ error: "File must be between 1 byte and 10 MB" }, { status: 400 });
  if (!ALLOWED.test(file.name)) return NextResponse.json({ error: "File type not allowed" }, { status: 400 });

  try {
    const out = await commitFile(
      file.name,
      Buffer.from(await file.arrayBuffer()),
      `Upload ${file.name} via dashboard (${s.email})`,
    );
    return NextResponse.json({ name: file.name, ...out });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 502 });
  }
}
