import * as fs from "node:fs/promises";
import { StorageAdapter } from "@reporead/core";
import type { WikiJson, PageMeta } from "@reporead/core";
import { notFound } from "next/navigation";
import { PageReaderClient } from "./page-reader-client";

async function getPageData(
  slug: string,
  versionId: string,
  pageSlug: string,
) {
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
  if (!wiki) return { prev: null, next: null, total: 0, current: 0 };
  const idx = wiki.reading_order.findIndex((p) => p.slug === pageSlug);
  return {
    prev: idx > 0 ? wiki.reading_order[idx - 1] : null,
    next:
      idx < wiki.reading_order.length - 1
        ? wiki.reading_order[idx + 1]
        : null,
    total: wiki.reading_order.length,
    current: idx + 1,
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
  const { prev, next, total, current } = findAdjacentPages(wiki, pageSlug);

  const currentPage = wiki?.reading_order.find((p) => p.slug === pageSlug);

  const allPages =
    wiki?.reading_order.map((p) => ({
      slug: p.slug,
      title: p.title,
    })) ?? [];

  return (
    <PageReaderClient
      slug={slug}
      versionId={versionId}
      pageSlug={pageSlug}
      markdown={markdown}
      meta={meta}
      prev={prev}
      next={next}
      total={total}
      current={current}
      allPages={allPages}
      section={currentPage?.section}
      kind={currentPage?.kind}
      level={currentPage?.level}
    />
  );
}
