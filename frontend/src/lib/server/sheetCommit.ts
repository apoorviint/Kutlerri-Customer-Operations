import { drop, forward, keepInGitHub, reply, unstash, whoAmI } from "./uploads";

/** Saves a checked sheet (the backend stores the rows), then keeps the original file in GitHub. */
export async function commitSheet(req: Request, kind: "assignments" | "billing") {
  const raw = await req.text();
  let sent: { stagedId?: unknown; fileName?: unknown } = {};
  try { sent = JSON.parse(raw); } catch { /* the backend answers bad input */ }
  const res = await forward(req, `/api/admin/files/${kind}/commit`, raw, req.headers.get("content-type"));
  const answer = (await res.json().catch(() => ({ error: `Request failed (${res.status})` }))) as Record<string, unknown>;
  if (res.ok && answer.committed === true && typeof answer.uploadId === "number") {
    const fileName = typeof sent.fileName === "string" && sent.fileName ? sent.fileName : `${kind}.xlsx`;
    const warning = await keepInGitHub(kind, answer.uploadId, fileName, await unstash(sent.stagedId), await whoAmI(req));
    if (warning) answer.warning = warning;
  }
  if (res.ok) await drop(sent.stagedId); // saved, or nothing to save: either way the file is no longer needed here
  return reply(res.status, answer);
}
