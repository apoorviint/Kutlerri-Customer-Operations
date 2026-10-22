/**
 * Keeps every saved upload (who-dialed-for-whom sheet, billing sheet, prospect database) in GitHub:
 * one commit per file under uploads/ in GITHUB_UPLOADS_REPO (default branch: main).
 *
 * Runs on the website's server only. GITHUB_TOKEN is a fine-grained token with "Contents: read and write"
 * on that one repository; it never reaches the browser. The Git Data API takes files up to 100 MB.
 */
const API = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, ""); // overridable for tests

export const githubEnabled = () => !!(process.env.GITHUB_TOKEN && process.env.GITHUB_UPLOADS_REPO);

const clean = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";

/** Where a file is kept: uploads/<kind>/<id>-<name>. */
export const uploadPath = (kind: "assignments" | "billing" | "prospects", id: number, fileName: string) =>
  `${(process.env.GITHUB_UPLOADS_PATH ?? "uploads").replace(/^\/+|\/+$/g, "")}/${kind}/${id}-${clean(fileName.split(/[\\/]/).pop() ?? "")}`;

async function gh<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API()}/repos/${process.env.GITHUB_UPLOADS_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

function check<T>(r: { status: number; json: T }, what: string): T {
  // GitHub's message says what is wrong (permissions, repository name, branch protection); the token is never echoed
  if (r.status >= 400) throw new Error(`GitHub refused to ${what} (${r.status} ${(r.json as { message?: string }).message ?? ""}).`);
  return r.json;
}

/**
 * Uploads hold billing amounts and prospect names and phone numbers, so they are never written to a public repository
 * (anyone could read them, and git history keeps them even after deletion). Checked before every commit.
 */
async function assertPrivate() {
  const repo = check(await gh<{ private?: boolean }>("GET", ""), "read the repository");
  if (repo.private !== true) {
    throw new Error(`${process.env.GITHUB_UPLOADS_REPO} is public, so the file was not saved there. Make the repository private (Settings → General → Change visibility), or use a private one.`);
  }
}

/** Adds one file as one commit on the branch. Retries if someone else committed at the same moment. */
export async function commitUpload(path: string, content: Uint8Array, message: string): Promise<void> {
  const branch = process.env.GITHUB_UPLOADS_BRANCH || "main";
  type Ref = { object: { sha: string } };
  await assertPrivate();
  const blob = check(await gh<{ sha: string }>("POST", "/git/blobs", { content: Buffer.from(content).toString("base64"), encoding: "base64" }), "save the file");
  for (let attempt = 0; ; attempt++) {
    const head = check(await gh<Ref>("GET", `/git/ref/heads/${branch}`), `read the ${branch} branch`).object.sha;
    const base = check(await gh<{ tree: { sha: string } }>("GET", `/git/commits/${head}`), `read the ${branch} branch`).tree.sha;
    const tree = check(await gh<{ sha: string }>("POST", "/git/trees", { base_tree: base, tree: [{ path, mode: "100644", type: "blob", sha: blob.sha }] }), "save the file");
    const commit = check(await gh<{ sha: string }>("POST", "/git/commits", { message, tree: tree.sha, parents: [head] }), "save the file");
    const moved = await gh("PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha });
    if (moved.status === 422 && attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); continue; }
    check(moved, "save the file");
    return;
  }
}
