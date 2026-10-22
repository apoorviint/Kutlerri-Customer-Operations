import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

const gh = config.github;

function client() {
  if (!gh.token || !gh.owner || !gh.repo) throw new Error("GitHub is not configured (GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO)");
  return new Octokit({ auth: gh.token });
}

export function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}

const repoPath = (name: string) => `${gh.dir}/${safeName(name)}`;
const status = (e: unknown) => (e as { status?: number }).status;

async function existingSha(octokit: Octokit, path: string) {
  try {
    const res = await octokit.repos.getContent({ owner: gh.owner, repo: gh.repo, ref: gh.branch, path });
    return Array.isArray(res.data) ? undefined : res.data.sha;
  } catch (e) {
    if (status(e) === 404) return undefined;
    throw e;
  }
}

/** Commits the file to the repo. Re-uploading the same name replaces it. */
export async function commitFile(name: string, content: Buffer, message: string) {
  const octokit = client();
  const path = repoPath(name);
  const res = await octokit.repos.createOrUpdateFileContents({
    owner: gh.owner, repo: gh.repo, branch: gh.branch, path, message,
    content: content.toString("base64"),
    sha: await existingSha(octokit, path),
  });
  return { name: safeName(name), path, commitUrl: res.data.commit.html_url ?? null };
}

export async function deleteRepoFile(name: string, message: string) {
  const octokit = client();
  const path = repoPath(name);
  const sha = await existingSha(octokit, path);
  if (!sha) throw new Error("File not found in the repo");
  await octokit.repos.deleteFile({ owner: gh.owner, repo: gh.repo, branch: gh.branch, path, sha, message });
}

/** Files currently in the repo (live; the dashboard shows them once the next build is deployed). */
export async function listRepoFiles() {
  const octokit = client();
  try {
    const res = await octokit.repos.getContent({ owner: gh.owner, repo: gh.repo, ref: gh.branch, path: gh.dir });
    if (!Array.isArray(res.data)) return [];
    return res.data
      .filter((f) => f.type === "file" && f.name !== ".gitkeep")
      .map((f) => ({ name: f.name, size: f.size, htmlUrl: f.html_url ?? null }));
  } catch (e) {
    if (status(e) === 404) return [];
    throw e;
  }
}
