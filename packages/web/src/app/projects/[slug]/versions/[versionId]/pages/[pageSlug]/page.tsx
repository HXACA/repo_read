import * as fs from "node:fs/promises";
import Link from "next/link";
import { StorageAdapter } from "@reporead/core";
import type { WikiJson, PageMeta } from "@reporead/core";
import { notFound } from "next/navigation";
import { MarkdownRenderer } from "./markdown-renderer";
import { ChatDock } from "./chat-dock";

async function getPageData(slug: string, versionId: string, pageSlug: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);

  let markdown: string;
  try {
    markdown = await fs.readFile(
      storage.paths.versionPageMd(slug, versionId, pageSlug),
      "utf-8",
    );
  } catch {
    return null;
  }

  const meta = await storage.readJson<PageMeta>(
    storage.paths.versionPageMeta(slug, versionId, pageSlug),
  );
  const wiki = await storage.readJson<WikiJson>(
    storage.paths.versionWikiJson(slug, versionId),
  );

  return { markdown, meta, wiki };
}

function findAdjacentPages(wiki: WikiJson | null, pageSlug: string) {
  if (!wiki) return { prev: null, next: null };
  const idx = wiki.reading_order.findIndex((p) => p.slug === pageSlug);
  return {
    prev: idx > 0 ? wiki.reading_order[idx - 1] : null,
    next: idx < wiki.reading_order.length - 1 ? wiki.reading_order[idx + 1] : null,
  };
}

export default async function PageReader({
  params,
}: {
  params: Promise<{ slug: string; versionId: string; pageSlug: string }>;
}) {
  const { slug, versionId, pageSlug } = await params;
  const data = await getPageData(slug, versionId, pageSlug);

  if (!data) notFound();

  const { markdown, meta, wiki } = data;
  const { prev, next } = findAdjacentPages(wiki, pageSlug);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <Link href={`/projects/${slug}/versions/${versionId}`} className="hover:text-blue-600">
          {slug}
        </Link>
        {" / "}
        <span>{meta?.title ?? pageSlug}</span>
      </nav>

      {meta && (
        <div className="mb-4 flex gap-4 text-xs text-gray-400">
          <span>Page {meta.order}</span>
          <span>Review: {meta.reviewStatus}</span>
          <span>Validation: {meta.validation.summary}</span>
        </div>
      )}

      <article className="prose prose-gray max-w-none dark:prose-invert">
        <MarkdownRenderer content={markdown} />
      </article>

      <nav className="mt-12 flex justify-between border-t border-gray-200 pt-6 dark:border-gray-700">
        {prev ? (
          <Link
            href={`/projects/${slug}/versions/${versionId}/pages/${prev.slug}`}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            &larr; {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/projects/${slug}/versions/${versionId}/pages/${next.slug}`}
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            {next.title} &rarr;
          </Link>
        ) : (
          <span />
        )}
      </nav>
      <ChatDock slug={slug} versionId={versionId} pageSlug={pageSlug} />
    </main>
  );
}
