import Nav from "@/components/Nav";
import { db } from "@/lib/db";
import AdminPanel from "./AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const files = await db.uploadedFile.findMany({
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { email: true } } },
  });
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <AdminPanel />
        <section className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr><th className="p-3">File</th><th>Size</th><th>Uploaded by</th><th>When</th><th>Repo</th></tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="p-3"><a className="underline" href={`/api/files/${f.id}`}>{f.name}</a></td>
                  <td>{(f.size / 1024).toFixed(1)} KB</td>
                  <td>{f.uploadedBy.email}</td>
                  <td>{f.createdAt.toLocaleString()}</td>
                  <td>{f.htmlUrl && <a className="underline" href={f.htmlUrl} target="_blank" rel="noreferrer">GitHub</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
