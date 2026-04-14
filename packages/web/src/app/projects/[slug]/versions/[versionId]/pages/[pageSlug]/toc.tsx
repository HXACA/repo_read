"use client";

import { useEffect, useState, useMemo } from "react";
import { cleanContent } from "./markdown-renderer";

type Heading = {
  level: number;
  text: string;
  id: string;
};

/** Slugify (must match markdown-renderer.tsx) */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build a stateful id generator that disambiguates collisions in document
 * order: the first occurrence gets the plain slug, subsequent occurrences
 * get `slug-2`, `slug-3`, etc. Both the TOC and markdown-renderer must
 * walk headings in the same order and use the same algorithm so the TOC
 * link's `href="#id"` matches the `<h*>` `id` attribute in the rendered
 * article.
 */
function makeHeadingIdFactory(): (text: string) => string {
  const counts = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

/**
 * Parse H2/H3 headings out of markdown for the sidebar TOC.
 * Skips headings inside code fences.
 */
function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const lines = markdown.split("\n");
  let inCodeFence = false;
  const makeId = makeHeadingIdFactory();

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // The markdown-renderer only instruments h1-h4 with id attributes;
    // walk those through the factory to keep numbering in sync.
    const match = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].replace(/[*_`]/g, "").trim();
      const id = makeId(text);
      // But only display h2/h3 in the TOC sidebar.
      if (level >= 2 && level <= 3) {
        headings.push({ level, text, id });
      }
    }
  }
  return headings;
}

/**
 * Controlled TOC — collapse state comes from parent so the main layout
 * can react (expand main content width when collapsed).
 */
export function TableOfContents({
  content,
  collapsed,
  onToggle,
}: {
  content: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const headings = useMemo(() => parseHeadings(cleanContent(content)), [content]);
  const [activeId, setActiveId] = useState<string>("");

  // Track which heading is currently in view via IntersectionObserver
  useEffect(() => {
    if (headings.length === 0 || collapsed) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -70% 0px",
        threshold: 0,
      },
    );

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings, collapsed]);

  if (headings.length === 0) return null;

  // Collapsed rail — shown on lg+ screens. Clicks anywhere on the rail
  // re-expands. Left-pointing arrow because expanding pushes main content left.
  if (collapsed) {
    return (
      <aside className="sticky top-6 hidden shrink-0 self-start lg:block">
        <button
          onClick={onToggle}
          className="group flex flex-col items-center gap-2 rounded-md px-2 py-3 transition-colors hover:brightness-95"
          style={{
            background: "var(--rr-bg-elevated)",
            border: "1px solid var(--rr-border)",
            color: "var(--rr-text-secondary)",
          }}
          title="展开目录 · Expand TOC"
        >
          {/* Left-pointing chevron: expanding moves content left */}
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
          <span
            style={{
              writingMode: "vertical-rl",
              fontSize: "0.7rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            目录
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="sticky top-6 hidden max-h-[calc(100vh-6rem)] shrink-0 self-start overflow-y-auto lg:block"
      style={{ width: "240px" }}
    >
      <div
        className="flex items-center justify-between pb-3 pl-4"
        style={{ borderLeft: "1px solid var(--rr-border)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--rr-text-muted)" }}
        >
          目录 · Contents
        </span>
        <button
          onClick={onToggle}
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-black/5"
          style={{ color: "var(--rr-text-muted)" }}
          title="收起目录 · Collapse TOC"
        >
          {/* Right-pointing chevron: collapsing moves TOC toward the right edge */}
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
        </button>
      </div>
      <nav
        className="text-sm"
        style={{
          borderLeft: "1px solid var(--rr-border)",
          paddingLeft: "1rem",
        }}
      >
        <ul className="space-y-1.5">
          {headings.map((h) => {
            const isActive = h.id === activeId;
            return (
              <li
                key={h.id}
                style={{ paddingLeft: h.level === 3 ? "1rem" : 0 }}
              >
                <a
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(h.id);
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth", block: "start" });
                      history.replaceState(null, "", `#${h.id}`);
                    }
                  }}
                  className="block truncate leading-snug transition-colors"
                  style={{
                    color: isActive
                      ? "var(--rr-accent)"
                      : "var(--rr-text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: h.level === 3 ? "0.8125rem" : "0.875rem",
                  }}
                  title={h.text}
                >
                  {h.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
