import { fileFrom, forward, keepInGitHub, reply, whoAmI } from "@/lib/server/uploads";

/** A prospect database: the backend accepts it and reads it in the background; the original is kept in GitHub. */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type");
  const body = await req.arrayBuffer();
  const res = await forward(req, "/api/admin/files/prospects/upload", body, contentType);
  const answer = (await res.json().catch(() => ({ error: `Request failed (${res.status})` }))) as Record<string, unknown>;
  if (res.status === 202 && typeof answer.batchId === "number") {
    const file = await fileFrom(body, contentType);
    const warning = await keepInGitHub("prospects", answer.batchId, file?.name ?? "prospects.xlsx",
      file ? new Uint8Array(await file.arrayBuffer()) : null, await whoAmI(req));
    if (warning) answer.warning = warning;
  }
  return reply(res.status, answer);
}
