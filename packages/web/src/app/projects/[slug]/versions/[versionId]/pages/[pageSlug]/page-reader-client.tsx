"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PageMeta } from "@reporead/core";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";
import { MarkdownRenderer } from "./markdown-renderer";
import { ChatDock } from "./chat-dock";
import { TableOfContents } from "./toc";
import { ChapterNav } from "./chapter-nav";
import { ReviewButton } from "./review-button";

type PageLink = { slug: string; title: string } | null;
type PageItem = { slug: string; title: string };

const TOC_LS_KEY = "reporead-toc-collapsed";
const NAV_LS_KEY = "reporead-nav-collapsed";

export function PageReaderClient({
  slug,
  versionId,
  pageSlug,
  markdown,
  meta,
  prev,
  next,
  total,
  current,
  allPages,
}: {
  slug: string;
  versionId: string;
  pageSlug: string;
  markdown: string;
  meta: PageMeta | null;
  prev: PageLink;
  next: PageLink;
  total: number;
  current: number;
  allPages: PageItem[];
}) {
  const { locale } = useSettings();
  // Read localStorage synchronously in initializer to avoid flash of
  // wrong state (sidebar expands then immediately collapses).
  const [tocCollapsed, setTocCollapsed] = useState(() => {
    try { return localStorage.getItem(TOC_LS_KEY) === "true"; } catch { return false; }
  });
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem(NAV_LS_KEY) === "true"; } catch { return false; }
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Persist state
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(TOC_LS_KEY, String(tocCollapsed));
      localStorage.setItem(NAV_LS_KEY, String(navCollapsed));
    } catch {
      /* ignore */
    }
  }, [tocCollapsed, navCollapsed, mounted]);

  // Main content max-width expands when sidebars are collapsed
  const bothCollapsed = tocCollapsed && navCollapsed;
  const mainMaxWidth = bothCollapsed
    ? "72rem"
    : tocCollapsed || navCollapsed
      ? "64rem"
      : "56rem";

  return (
    <div
      className="mx-auto flex justify-center gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:gap-8"
      style={{ maxWidth: "1600px" }}
    >
      <ChapterNav
        slug={slug}
        versionId={versionId}
        pageSlug={pageSlug}
        pages={allPages}
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((v) => !v)}
        locale={locale}
      />
      <main
        className="min-w-0 flex-1 transition-[max-width] duration-200"
        style={{ maxWidth: mainMaxWidth }}
      >
        {/* Breadcrumb */}
        <nav
          className="mb-6 flex items-center gap-2 text-sm"
          style={{ color: "var(--rr-text-muted)" }}
        >
          <Link
            href="/"
            className="hover:underline"
            style={{ color: "var(--rr-accent)" }}
          >
            {t(locale, "home")}
          </Link>
          <span>/</span>
          <Link
            href={`/projects/${slug}/versions/${versionId}`}
            className="hover:underline"
            style={{ color: "var(--rr-accent)" }}
          >
            {slug}
          </Link>
          <span>/</span>
          <span style={{ color: "var(--rr-text-secondary)" }}>
            {meta?.title ?? pageSlug}
          </span>
        </nav>

        {/* Page position indicator */}
        {meta && (
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
              style={{
                background: "var(--rr-accent-subtle)",
                color: "var(--rr-accent)",
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              {t(locale, "page")} {current} {t(locale, "of")} {total}
            </span>
            <ReviewButton
              reviewStatus={meta.reviewStatus}
              reviewDigest={meta.reviewDigest}
              locale={locale}
            />
            {typeof meta.revisionAttempts === "number" &&
              meta.revisionAttempts > 0 && (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                  style={{
                    background: "var(--rr-bg-surface)",
                    color: "var(--rr-text-secondary)",
                    border: "1px solid var(--rr-border)",
                    fontFamily: "var(--font-mono), monospace",
                  }}
                  title={
                    locale === "zh"
                      ? "审阅后重新修订的次数"
                      : "Number of revision rounds after review"
                  }
                >
                  {locale === "zh"
                    ? `重写 ${meta.revisionAttempts} 次`
                    : `revised ×${meta.revisionAttempts}`}
                </span>
              )}
          </div>
        )}

        {/* Article */}
        <article className="prose prose-stone max-w-none dark:prose-invert">
          <MarkdownRenderer
            key={`${slug}-${versionId}-${pageSlug}`}
            content={markdown}
            slug={slug}
            versionId={versionId}
          />
        </article>

        {/* Prev / Next navigation */}
        <nav
          className="mt-14 grid grid-cols-1 gap-4 pt-8 sm:grid-cols-2"
          style={{ borderTop: "1px solid var(--rr-border)" }}
        >
          {prev ? (
            <Link
              href={`/projects/${slug}/versions/${versionId}/pages/${prev.slug}`}
              className="group rounded-lg p-4 text-left transition-colors"
              style={{
                border: "1px solid var(--rr-border)",
                background: "var(--rr-bg-elevated)",
              }}
            >
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--rr-text-muted)" }}
              >
                &larr; {t(locale, "previous")}
              </span>
              <span
                className="mt-1 block text-sm font-medium"
                style={{
                  fontFamily: "var(--font-display), Georgia, serif",
                  color: "var(--rr-text)",
                }}
              >
                {prev.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/projects/${slug}/versions/${versionId}/pages/${next.slug}`}
              className="group rounded-lg p-4 text-right transition-colors sm:col-start-2"
              style={{
                border: "1px solid var(--rr-border)",
                background: "var(--rr-bg-elevated)",
              }}
            >
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--rr-text-muted)" }}
              >
                {t(locale, "next")} &rarr;
              </span>
              <span
                className="mt-1 block text-sm font-medium"
                style={{
                  fontFamily: "var(--font-display), Georgia, serif",
                  color: "var(--rr-text)",
                }}
              >
                {next.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>

        <ChatDock slug={slug} versionId={versionId} pageSlug={pageSlug} />
      </main>

      <TableOfContents
        key={`toc-${pageSlug}`}
        content={markdown}
        collapsed={tocCollapsed}
        onToggle={() => setTocCollapsed((v) => !v)}
      />
    </div>
  );
}
