"use client";

import Link from "next/link";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";

type ProjectInfo = {
  projectSlug: string;
  repoRoot: string;
  latestVersionId?: string;
};

export function HomeClient({ projects }: { projects: ProjectInfo[] }) {
  const { locale } = useSettings();

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      {/* Hero */}
      <div className="mb-12">
        <h1
          className="text-4xl font-bold tracking-tight"
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            color: "var(--rr-text)",
          }}
        >
          {t(locale, "heroTitle1")}
          <br />
          <span style={{ color: "var(--rr-accent)" }}>
            {t(locale, "heroTitle2")}
          </span>
        </h1>
        <p
          className="mt-4 max-w-lg text-lg leading-relaxed whitespace-pre-line"
          style={{ color: "var(--rr-text-secondary)" }}
        >
          {t(locale, "tagline")}
        </p>
      </div>

      {/* Projects */}
      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--rr-text-muted)" }}
          >
            {t(locale, "projects")}
          </h2>
          <span className="text-xs" style={{ color: "var(--rr-text-muted)" }}>
            {projects.length}
          </span>
        </div>

        {projects.length === 0 ? (
          <div
            className="rounded-lg p-8 text-center"
            style={{
              background: "var(--rr-bg-surface)",
              border: "1px dashed var(--rr-border-strong)",
            }}
          >
            <p className="text-sm" style={{ color: "var(--rr-text-secondary)" }}>
              {t(locale, "noProjects")}{" "}
              <code className="inline-code">repo-read init</code>{" "}
              {t(locale, "toCreate")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.projectSlug}
                href={
                  p.latestVersionId
                    ? `/projects/${p.projectSlug}/versions/${p.latestVersionId}`
                    : `/projects/${p.projectSlug}`
                }
                className="group block rounded-lg p-5"
                style={{
                  background: "var(--rr-bg-elevated)",
                  border: "1px solid var(--rr-border)",
                  boxShadow: "var(--rr-shadow)",
                }}
              >
                <div className="flex items-start justify-between">
                  <h3
                    className="text-base font-semibold"
                    style={{
                      fontFamily: "var(--font-display), Georgia, serif",
                      color: "var(--rr-text)",
                    }}
                  >
                    {p.projectSlug}
                  </h3>
                  <span
                    className="text-lg opacity-40 transition-opacity group-hover:opacity-80"
                    style={{ color: "var(--rr-accent)" }}
                  >
                    &rarr;
                  </span>
                </div>
                <p
                  className="mt-1.5 truncate text-sm font-mono"
                  style={{ color: "var(--rr-text-muted)" }}
                >
                  {p.repoRoot}
                </p>
                {p.latestVersionId && (
                  <div className="mt-3 flex items-center gap-1.5">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: "var(--rr-accent)" }}
                    />
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--rr-accent)" }}
                    >
                      {t(locale, "latestVersion")}: {p.latestVersionId}
                    </span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
