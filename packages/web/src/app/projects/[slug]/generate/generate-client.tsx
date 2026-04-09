"use client";

import Link from "next/link";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";

type JobSummary = {
  id: string;
  status: string;
  versionId: string;
  createdAt: string;
  totalPages: number | null;
  succeededPages: number;
  lastError: string | null;
};

function statusStyle(status: string) {
  switch (status) {
    case "completed":
      return { background: "#DCFCE7", color: "#166534" };
    case "failed":
      return { background: "#FEE2E2", color: "#991B1B" };
    case "interrupted":
      return { background: "#FEF3C7", color: "#92400E" };
    default:
      return {
        background: "var(--rr-accent-subtle)",
        color: "var(--rr-accent)",
      };
  }
}

export function GenerateClient({
  slug,
  repoRoot,
  jobs,
}: {
  slug: string;
  repoRoot: string;
  jobs: JobSummary[];
}) {
  const { locale } = useSettings();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm" style={{ color: "var(--rr-text-muted)" }}>
        <Link
          href="/"
          className="hover:underline"
          style={{ color: "var(--rr-accent)" }}
        >
          {t(locale, "home")}
        </Link>
        <span className="mx-2">/</span>
        <Link
          href={`/projects/${slug}`}
          className="hover:underline"
          style={{ color: "var(--rr-accent)" }}
        >
          {slug}
        </Link>
        <span className="mx-2">/</span>
        <span style={{ color: "var(--rr-text-secondary)" }}>
          {locale === "zh" ? "生成" : "Generate"}
        </span>
      </nav>

      <h1
        className="text-3xl font-bold tracking-tight"
        style={{
          fontFamily: "var(--font-display), Georgia, serif",
          color: "var(--rr-text)",
        }}
      >
        {locale === "zh" ? "生成 Wiki" : "Generate Wiki"}
      </h1>
      <p className="mt-2 text-sm font-mono" style={{ color: "var(--rr-text-muted)" }}>
        {repoRoot}
      </p>

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

      <section className="mt-8">
        <h2
          className="mb-4 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--rr-text-muted)" }}
        >
          {locale === "zh" ? "近期任务" : "Recent Jobs"}
        </h2>
        {jobs.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--rr-text-muted)" }}>
            {locale === "zh" ? "暂无生成任务。" : "No generation jobs yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/projects/${slug}/jobs/${job.id}`}
                  className="group block rounded-lg px-4 py-3.5 transition-colors"
                  style={{
                    border: "1px solid var(--rr-border)",
                    background: "var(--rr-bg-elevated)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="text-sm font-mono"
                      style={{ color: "var(--rr-text)" }}
                    >
                      {job.id.slice(0, 8)}
                    </span>
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-medium"
                      style={statusStyle(job.status)}
                    >
                      {job.status === "completed"
                        ? t(locale, "jobCompleted")
                        : job.status === "failed"
                          ? t(locale, "jobFailed")
                          : job.status}
                    </span>
                  </div>
                  <div
                    className="mt-2 flex gap-4 text-xs"
                    style={{ color: "var(--rr-text-muted)" }}
                  >
                    <span>
                      {locale === "zh" ? "版本" : "Version"}: {job.versionId}
                    </span>
                    {job.totalPages != null && (
                      <span>
                        {t(locale, "pages")}: {job.succeededPages}/
                        {job.totalPages}
                      </span>
                    )}
                    <span>
                      {new Date(job.createdAt).toLocaleString(
                        locale === "zh" ? "zh-CN" : "en-US",
                      )}
                    </span>
                  </div>
                  {job.lastError && (
                    <p className="mt-2 text-xs" style={{ color: "#DC2626" }}>
                      {job.lastError}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
