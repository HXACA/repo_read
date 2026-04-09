"use client";

import Link from "next/link";

type PageItem = {
  slug: string;
  title: string;
};

/**
 * Left-side sidebar listing all pages in the current version's reading order.
 * Highlights the current page. Controlled collapsed state from parent.
 */
export function ChapterNav({
  slug,
  versionId,
  pageSlug,
  pages,
  collapsed,
  onToggle,
  locale,
}: {
  slug: string;
  versionId: string;
  pageSlug: string;
  pages: PageItem[];
  collapsed: boolean;
  onToggle: () => void;
  locale: "zh" | "en";
}) {
  if (pages.length === 0) return null;

  // Collapsed rail
  if (collapsed) {
    return (
      <aside className="sticky top-6 hidden shrink-0 self-start md:block">
        <button
          onClick={onToggle}
          className="group flex flex-col items-center gap-2 rounded-md px-2 py-3 transition-colors hover:brightness-95"
          style={{
            background: "var(--rr-bg-elevated)",
            border: "1px solid var(--rr-border)",
            color: "var(--rr-text-secondary)",
          }}
          title={locale === "zh" ? "展开章节" : "Expand chapters"}
        >
          {/* Right-pointing chevron: expanding pushes content right */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path
              d="M5 3l4 4-4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            style={{
              writingMode: "vertical-rl",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {locale === "zh" ? "章节" : "Pages"}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="sticky top-6 hidden max-h-[calc(100vh-6rem)] shrink-0 self-start overflow-y-auto md:block"
      style={{ width: "220px" }}
    >
      <div
        className="mb-3 flex items-center justify-between pb-2"
        style={{ borderBottom: "1px solid var(--rr-border)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--rr-text-muted)" }}
        >
          {locale === "zh" ? "章节 · Pages" : "Chapters"}
        </span>
        <button
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-black/5"
          style={{ color: "var(--rr-text-muted)" }}
          title={locale === "zh" ? "收起章节" : "Collapse"}
        >
          {/* Left-pointing chevron: collapsing moves toward left edge */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path
              d="M9 3l-4 4 4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <nav>
        <ol className="space-y-0.5">
          {pages.map((page, idx) => {
            const isActive = page.slug === pageSlug;
            return (
              <li key={page.slug}>
                <Link
                  href={`/projects/${slug}/versions/${versionId}/pages/${page.slug}`}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 leading-snug transition-colors"
                  style={{
                    background: isActive
                      ? "var(--rr-accent-subtle)"
                      : "transparent",
                    color: isActive
                      ? "var(--rr-accent)"
                      : "var(--rr-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: "0.8125rem",
                    borderLeft: isActive
                      ? "2px solid var(--rr-accent)"
                      : "2px solid transparent",
                  }}
                  title={page.title}
                >
                  <span
                    style={{
                      minWidth: "1.5rem",
                      textAlign: "right",
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: "0.6875rem",
                      color: isActive
                        ? "var(--rr-accent)"
                        : "var(--rr-text-muted)",
                      paddingTop: "0.0625rem",
                      flexShrink: 0,
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="flex-1 truncate"
                    style={{ minWidth: 0 }}
                  >
                    {page.title}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}
