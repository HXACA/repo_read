import * as fs from "node:fs/promises";
import Link from "next/link";
import { StorageAdapter } from "@reporead/core";
import type { WikiJson, PageMeta } from "@reporead/core";
import { notFound } from "next/navigation";

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
        <div dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />
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
    </main>
  );
}

/**
 * Simple markdown to HTML converter for server rendering.
 * Handles headings, paragraphs, code blocks, lists, bold, italic, links.
 * For V1, this is sufficient. A full parser (remark/rehype) can be added later.
 */
function markdownToHtml(md: string): string {
  let html = md
    // Code blocks (must be first to avoid processing content inside)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const escaped = escapeHtml(code.trim());
      return `<pre><code class="language-${lang || "text"}">${escaped}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Headings
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Unordered list items
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> items in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>$1</ul>");

  // Paragraphs: wrap non-tag lines separated by blank lines
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("<")) return trimmed;
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return html;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
