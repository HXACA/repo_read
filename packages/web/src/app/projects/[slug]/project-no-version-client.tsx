"use client";

import Link from "next/link";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";

export function ProjectNoVersionClient({
  slug,
  repoRoot,
}: {
  slug: string;
  repoRoot: string;
}) {
  const { locale } = useSettings();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
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

      <h1
        className="text-3xl font-bold tracking-tight"
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--rr-text)",
        }}
      >
        {slug}
      </h1>
      <p className="mt-4" style={{ color: "var(--rr-text-secondary)" }}>
        {t(locale, "noVersions")}
      </p>

      <div className="mt-6 flex gap-3">
        <Link
          href={`/projects/${slug}/generate`}
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
          style={{ background: "var(--rr-accent)" }}
        >
          {t(locale, "viewGenerate")}
        </Link>
      </div>

      <div
        className="mt-6 rounded-lg p-5"
        style={{
          background: "var(--rr-bg-surface)",
          border: "1px solid var(--rr-border)",
        }}
      >
        <p className="text-sm" style={{ color: "var(--rr-text-secondary)" }}>
          {t(locale, "runGenerate")}
        </p>
        <code
          className="mt-2 block rounded-md p-3 text-sm"
          style={{
            background: "var(--rr-code-bg)",
            color: "var(--rr-text)",
            fontFamily: "var(--font-mono), monospace",
            border: "1px solid var(--rr-border)",
          }}
        >
          repo-read generate -d {repoRoot}
        </code>
      </div>

      {/* Publish explanation */}
      <div
        className="mt-6 rounded-lg px-4 py-3 text-sm"
        style={{
          background: "var(--rr-accent-subtle)",
          color: "var(--rr-accent)",
          border: "1px solid var(--rr-border)",
        }}
      >
        {t(locale, "publishInfo")}
      </div>
    </main>
  );
}
