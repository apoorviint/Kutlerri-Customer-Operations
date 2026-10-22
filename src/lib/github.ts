import { Octokit } from "@octokit/rest";

function cfg() {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) throw new Error("GitHub env vars are not set");
  return {
    octokit: new Octokit({ auth: GITHUB_TOKEN }),
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: process.env.GITHUB_BRANCH || "main",
    dir: (process.env.GITHUB_UPLOAD_DIR || "uploads").replace(/^\/+|\/+$/g, ""),
  };
}

export function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "file";
}

export async function commitFile(name: string, content: Buffer, message: string) {
  const { octokit, owner, repo, branch, dir } = cfg();
  const path = `${dir}/${Date.now()}-${safeName(name)}`;
  const res = await octokit.repos.createOrUpdateFileContents({
    owner, repo, branch, path, message, content: content.toString("base64"),
  });
  return { path, sha: res.data.content?.sha ?? "", htmlUrl: res.data.content?.html_url ?? null };
}

export async function readBlob(sha: string) {
  const { octokit, owner, repo } = cfg();
  const res = await octokit.git.getBlob({ owner, repo, file_sha: sha });
  return Buffer.from(res.data.content, "base64");
}

export async function removeFile(path: string, sha: string) {
  const { octokit, owner, repo, branch } = cfg();
  await octokit.repos.deleteFile({ owner, repo, branch, path, sha, message: `Delete ${path} via dashboard` });
}
