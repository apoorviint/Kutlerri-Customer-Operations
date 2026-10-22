import { Octokit } from "@octokit/rest";

function cfg() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) throw new Error("GitHub env vars are not set");
  return {
    octokit: new Octokit({ auth: GITHUB_TOKEN }),
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || "main",
    dir: dataDir(),
  };
}

export function dataDir() {
  return (process.env.GITHUB_UPLOAD_DIR || "data").replace(/^\/+|\/+$/g, "");
}

export function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}

async function existingSha(path: string) {
  const { octokit, owner, repo, branch } = cfg();
  try {
    const res = await octokit.repos.getContent({ owner, repo, ref: branch, path });
    return Array.isArray(res.data) ? undefined : res.data.sha;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return undefined;
    throw e;
  }
}

/** Commits the file to the repo. Re-uploading the same name replaces it (a new version, same path). */
export async function commitFile(name: string, content: Buffer, message: string) {
  const { octokit, owner, repo, branch, dir } = cfg();
  const path = `${dir}/${safeName(name)}`;
  const res = await octokit.repos.createOrUpdateFileContents({
    owner, repo, branch, path, message,
    content: content.toString("base64"),
    sha: await existingSha(path),
  });
  return { path, commitUrl: res.data.commit.html_url ?? null };
}

export async function deleteRepoFile(name: string, message: string) {
  const { octokit, owner, repo, branch, dir } = cfg();
  const path = `${dir}/${safeName(name)}`;
  const sha = await existingSha(path);
  if (!sha) throw new Error("File not found in repo");
  await octokit.repos.deleteFile({ owner, repo, branch, path, sha, message });
}

/** Files currently in the repo (live, before the next build/deploy finishes). */
export async function listRepoFiles() {
  const { octokit, owner, repo, branch, dir } = cfg();
  try {
    const res = await octokit.repos.getContent({ owner, repo, ref: branch, path: dir });
    if (!Array.isArray(res.data)) return [];
    return res.data
      .filter((f) => f.type === "file" && f.name !== ".gitkeep")
      .map((f) => ({ name: f.name, size: f.size, htmlUrl: f.html_url }));
  } catch (e) {
    if ((e as { status?: number }).status === 404) return [];
    throw e;
  }
}
