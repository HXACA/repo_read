"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import type { WikiJson, VersionJson } from "@reporead/core";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";
import { BookTOC } from "./book-toc";

type VersionMeta = {
  versionId: string;
  createdAt: string;
  pageCount: number;
  commitHash: string;
  summary: string;
};

export function VersionClient({
  slug,
  versionId,
  wiki,
  version,
  allVersions,
  latestVersionId,
}: {
  slug: string;
  versionId: string;
  wiki: WikiJson;
  version: VersionJson | null;
  allVersions: VersionMeta[];
  latestVersionId?: string;
}) {
  const { locale } = useSettings();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      {/* Breadcrumb */}
      <nav className="mb-8 text-sm" style={{ color: "var(--rr-text-muted)" }}>
        <Link
          href="/"
          className="hover:underline"
          style={{ color: "var(--rr-accent)" }}
        >
          {t(locale, "home")}
        </Link>
        <span className="mx-2">/</span>
        <span style={{ color: "var(--rr-text-secondary)" }}>{slug}</span>
      </nav>

      {/* Header */}
      <div className="mb-10">
        <h1
          className="text-3xl font-bold tracking-tight"
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            color: "var(--rr-text)",
          }}
        >
          {slug}
        </h1>
        <p
          className="mt-3 text-base leading-relaxed"
          style={{ color: "var(--rr-text-secondary)" }}
        >
          {wiki.summary}
        </p>

        {version && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <VersionSwitcher
              slug={slug}
              currentVersionId={versionId}
              allVersions={allVersions}
              latestVersionId={latestVersionId}
              locale={locale}
            />
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
              style={{
                background: "var(--rr-accent-subtle)",
                color: "var(--rr-accent)",
              }}
            >
              {version.pageCount} {t(locale, "pages")}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-mono"
              style={{
                background: "var(--rr-bg-surface)",
                color: "var(--rr-text-secondary)",
                border: "1px solid var(--rr-border)",
              }}
            >
              {version.commitHash.slice(0, 8)}
            </span>
            <span className="text-xs" style={{ color: "var(--rr-text-muted)" }}>
              {new Date(version.createdAt).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en-US",
                { year: "numeric", month: "short", day: "numeric" },
              )}
            </span>
          </div>
        )}
      </div>

      {/* Table of Contents */}
      <section>
        <h2
          className="mb-5 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--rr-text-muted)" }}
        >
          {t(locale, "readingOrder")}
        </h2>

        {wiki.reading_order.some((p) => p.section) ? (
          <BookTOC
            pages={wiki.reading_order.map((p) => ({
              slug: p.slug,
              title: p.title,
              rationale: p.rationale,
              section: p.section,
              group: p.group,
              level: p.level,
              kind: p.kind,
            }))}
            projectSlug={slug}
            versionId={versionId}
          />
        ) : (
          <ol className="space-y-2">
            {wiki.reading_order.map((page, idx) => (
              <li key={page.slug}>
                <Link
                  href={`/projects/${slug}/versions/${versionId}/pages/${page.slug}`}
                  className="group flex items-start gap-4 rounded-lg px-4 py-3.5 transition-colors"
                  style={{
                    border: "1px solid var(--rr-border)",
                    background: "var(--rr-bg-elevated)",
                  }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
                    style={{
                      background: "var(--rr-accent-subtle)",
                      color: "var(--rr-accent)",
                      fontFamily: "var(--font-mono), monospace",
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      className="text-base font-medium"
                      style={{
                        fontFamily: "var(--font-display), Georgia, serif",
                        color: "var(--rr-text)",
                      }}
                    >
                      {page.title}
                    </h3>
                    <p
                      className="mt-0.5 truncate text-sm leading-snug"
                      style={{ color: "var(--rr-text-muted)" }}
                    >
                      {page.rationale}
                    </p>
                  </div>
                  <span
                    className="mt-1 shrink-0 text-sm opacity-0 transition-opacity group-hover:opacity-70"
                    style={{ color: "var(--rr-accent)" }}
                  >
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function VersionSwitcher({
  slug,
  currentVersionId,
  allVersions,
  latestVersionId,
  locale,
}: {
  slug: string;
  currentVersionId: string;
  allVersions: VersionMeta[];
  latestVersionId?: string;
  locale: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const zh = locale === "zh";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
        style={{
          background: "#DCFCE7",
          color: "#166534",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "#16A34A" }}
        />
        {currentVersionId === latestVersionId
          ? zh
            ? "最新版本"
            : "Latest"
          : zh
            ? "历史版本"
            : "Historical"}
        <span className="font-mono">
          {currentVersionId.slice(-6)}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <path
            d="M2 3l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-2 w-80 overflow-hidden rounded-lg"
          style={{
            background: "var(--rr-bg-elevated)",
            border: "1px solid var(--rr-border)",
            boxShadow: "var(--rr-shadow-lg)",
          }}
        >
          <div
            className="px-3 py-2 text-xs font-semibold uppercase tracking-wider"
            style={{
              color: "var(--rr-text-muted)",
              borderBottom: "1px solid var(--rr-border)",
            }}
          >
            {zh ? `全部版本 (${allVersions.length})` : `All Versions (${allVersions.length})`}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {allVersions.map((v) => {
              const isActive = v.versionId === currentVersionId;
              const isLatest = v.versionId === latestVersionId;
              return (
                <li key={v.versionId}>
                  <Link
                    href={`/projects/${slug}/versions/${v.versionId}`}
                    className="flex items-start gap-3 px-3 py-2.5 transition-colors"
                    style={{
                      background: isActive
                        ? "var(--rr-accent-subtle)"
                        : "transparent",
                      borderBottom: "1px solid var(--rr-border)",
                    }}
                    onClick={() => setOpen(false)}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isActive ? (
                        <span
                          style={{
                            color: "var(--rr-accent)",
                            fontSize: "14px",
                          }}
                        >
                          &#10003;
                        </span>
                      ) : (
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background: "var(--rr-border-strong)",
                          }}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-xs"
                          style={{
                            color: isActive
                              ? "var(--rr-accent)"
                              : "var(--rr-text)",
                          }}
                        >
                          {v.versionId}
                        </span>
                        {isLatest && (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{
                              background: "#DCFCE7",
                              color: "#166534",
                            }}
                          >
                            {zh ? "最新" : "LATEST"}
                          </span>
                        )}
                      </div>
                      <div
                        className="mt-0.5 flex gap-2 text-xs"
                        style={{ color: "var(--rr-text-muted)" }}
                      >
                        <span>
                          {v.pageCount} {t(locale, "pages")}
                        </span>
                        <span>&middot;</span>
                        <span className="font-mono">
                          {v.commitHash.slice(0, 7)}
                        </span>
                        <span>&middot;</span>
                        <span>
                          {new Date(v.createdAt).toLocaleDateString(
                            locale === "zh" ? "zh-CN" : "en-US",
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
