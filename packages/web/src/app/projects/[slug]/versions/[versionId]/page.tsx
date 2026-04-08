import Link from "next/link";
import { StorageAdapter } from "@reporead/core";
import type { WikiJson, VersionJson } from "@reporead/core";
import { notFound } from "next/navigation";

async function getVersionData(slug: string, versionId: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const wiki = await storage.readJson<WikiJson>(storage.paths.versionWikiJson(slug, versionId));
  const version = await storage.readJson<VersionJson>(storage.paths.versionJson(slug, versionId));
  return { wiki, version };
}

export default async function VersionPage({
  params,
}: {
  params: Promise<{ slug: string; versionId: string }>;
}) {
  const { slug, versionId } = await params;
  const { wiki, version } = await getVersionData(slug, versionId);

  if (!wiki) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <span>{slug}</span>
        {" / "}
        <span>{versionId}</span>
      </nav>

      <h1 className="text-3xl font-bold">{slug}</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-300">{wiki.summary}</p>

      {version && (
        <div className="mt-4 flex gap-4 text-sm text-gray-500">
          <span>{version.pageCount} pages</span>
          <span>Commit: {version.commitHash.slice(0, 8)}</span>
          <span>{new Date(version.createdAt).toLocaleDateString()}</span>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Reading Order</h2>
        <ol className="mt-4 space-y-2">
          {wiki.reading_order.map((page, idx) => (
            <li key={page.slug}>
              <Link
                href={`/projects/${slug}/versions/${versionId}/pages/${page.slug}`}
                className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-gray-900"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {idx + 1}
                </span>
                <div>
                  <h3 className="font-medium">{page.title}</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {page.rationale}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
