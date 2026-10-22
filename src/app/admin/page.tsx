import Nav from "@/components/Nav";
import { listRepoFiles } from "@/lib/github";
import { listBuiltFiles } from "@/lib/files";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let repoFiles: Awaited<ReturnType<typeof listRepoFiles>> = [];
  let error: string | null = null;
  try {
    repoFiles = await listRepoFiles();
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not reach GitHub";
  }
  const built = new Set((await listBuiltFiles()).map((f) => f.name));

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <AdminPanel files={repoFiles.map((f) => f.name)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <section className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-3">File in repo</th><th>Size</th><th>Dashboard</th><th>GitHub</th></tr>
            </thead>
            <tbody>
              {repoFiles.map((f) => (
                <tr key={f.name} className="border-t">
                  <td className="p-3">{f.name}</td>
                  <td>{(f.size / 1024).toFixed(1)} KB</td>
                  <td>{built.has(f.name) ? "Live" : "Waiting for build…"}</td>
                  <td><a className="underline" href={f.htmlUrl ?? "#"} target="_blank" rel="noreferrer">View</a></td>
                </tr>
              ))}
              {repoFiles.length === 0 && !error && (
                <tr><td className="p-3 text-slate-500" colSpan={4}>No files yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-slate-500">
          Uploads are committed to GitHub. The dashboard updates once your host finishes building the new commit.
          &quot;Live&quot; means the file is part of the running build. Updates to an existing file show as Live
          immediately, so check the host&apos;s deploy status to confirm.
        </p>
      </main>
    </>
  );
}
