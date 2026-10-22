import { fileFrom, forward, reply, stash } from "./uploads";

/** Checks a who-dialed-for-whom or billing sheet (the backend does the work) and keeps the file until it is saved. */
export async function previewSheet(req: Request, kind: "assignments" | "billing") {
  const contentType = req.headers.get("content-type");
  const body = await req.arrayBuffer();
  const res = await forward(req, `/api/admin/files/${kind}/preview`, body, contentType);
  const answer = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (res.ok) {
    const file = await fileFrom(body, contentType);
    if (file) await stash((answer as { stagedId?: unknown }).stagedId, file);
  }
  return reply(res.status, answer);
}
