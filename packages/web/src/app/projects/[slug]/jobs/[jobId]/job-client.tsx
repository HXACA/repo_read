"use client";

import Link from "next/link";
import { useSettings } from "@/lib/settings-context";
import { t } from "@/lib/i18n";

type EventItem = {
  id: string;
  type: string;
  at: string;
  pageSlug: string | null;
  payload?: Record<string, unknown> | null;
};

function eventDetail(type: string, payload: Record<string, unknown> | null | undefined, zh: boolean): string | null {
  if (!payload) return null;
  if (type === "page.evidence_planned") {
    const n = payload.taskCount as number | undefined;
    const fallback = payload.usedFallback as boolean | undefined;
    if (typeof n !== "number") return null;
    const label = zh ? `${n} 个取证任务` : `${n} tasks`;
    return fallback ? `${label}${zh ? " (降级均分)" : " (fallback split)"}` : label;
  }
  if (type === "page.evidence_collected") {
    const c = payload.citationCount as number | undefined;
    const w = payload.workerCount as number | undefined;
    const f = payload.failedCount as number | undefined;
    if (typeof c !== "number") return null;
    const parts: string[] = [];
    parts.push(zh ? `${w ?? 0} 个 worker` : `${w ?? 0} workers`);
    parts.push(zh ? `${c} 条引用` : `${c} citations`);
    if (f && f > 0) parts.push(zh ? `${f} 失败` : `${f} failed`);
    return parts.join(" · ");
  }
  if (type === "page.reviewed") {
    const v = payload.verdict as string | undefined;
    if (!v) return null;
    return v === "pass" ? (zh ? "通过" : "pass") : (zh ? "需修订" : "revise");
  }
  if (type === "page.validated") {
    const passed = payload.passed as boolean | undefined;
    if (passed === undefined) return null;
    return passed ? (zh ? "通过" : "pass") : (zh ? "未通过" : "fail");
  }
  return null;
}

function eventIcon(type: string): string {
  // More specific matches must come before generic ones.
  if (type.includes("evidence_planned")) return "\u29BF"; // ⦿ — planning
  if (type.includes("evidence_collected")) return "\u2756"; // ❖ — collected bundle
  if (type.includes("started")) return "\u25B6"; // ▶
  if (type.includes("completed")) return "\u2713"; // ✓
  if (type.includes("failed")) return "\u2717"; // ✗
  if (type.includes("drafting")) return "\u270E"; // ✎
  if (type.includes("drafted")) return "\u270E"; // ✎
  if (type.includes("reviewed")) return "\u2298"; // ⊘
  if (type.includes("validated")) return "\u2713"; // ✓
  return "\u00B7";
}

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

export function JobClient({
  slug,
  jobId,
  status,
  versionId,
  createdAt,
  totalPages,
  succeededPages,
  currentPageSlug,
  lastError,
  events,
}: {
  slug: string;
  jobId: string;
  status: string;
  versionId: string;
  createdAt: string;
  totalPages: number | null;
  succeededPages: number;
  currentPageSlug: string | null;
  lastError: string | null;
  events: EventItem[];
}) {
  const { locale } = useSettings();

  const zh = locale === "zh";

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
          href={`/projects/${slug}/generate`}
          className="hover:underline"
          style={{ color: "var(--rr-accent)" }}
        >
          {slug}
        </Link>
        <span className="mx-2">/</span>
        <span style={{ color: "var(--rr-text-secondary)" }}>
          {zh ? "任务" : "Job"} {jobId.slice(0, 8)}
        </span>
      </nav>

      <div className="flex items-center gap-4">
        <h1
          className="text-2xl font-bold tracking-tight"
          style={{
            fontFamily: "var(--font-display), Georgia, serif",
            color: "var(--rr-text)",
          }}
        >
          {zh ? "任务" : "Job"} {jobId.slice(0, 8)}
        </h1>
        <span
          className="rounded-md px-2.5 py-1 text-xs font-medium"
          style={statusStyle(status)}
        >
          {status === "completed"
            ? t(locale, "jobCompleted")
            : status === "failed"
              ? t(locale, "jobFailed")
              : status}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        {[
          { label: zh ? "版本" : "Version", value: versionId },
          {
            label: zh ? "创建时间" : "Created",
            value: new Date(createdAt).toLocaleString(
              zh ? "zh-CN" : "en-US",
            ),
          },
          ...(totalPages != null
            ? [
                {
                  label: t(locale, "pages"),
                  value: `${succeededPages} / ${totalPages}`,
                },
              ]
            : []),
          ...(currentPageSlug
            ? [{ label: zh ? "当前页" : "Current", value: currentPageSlug }]
            : []),
        ].map(({ label, value }) => (
          <div key={label}>
            <span
              className="text-xs uppercase tracking-wider"
              style={{ color: "var(--rr-text-muted)" }}
            >
              {label}
            </span>
            <p
              className="mt-0.5 font-medium"
              style={{ color: "var(--rr-text)" }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {lastError && (
        <div
          className="mt-5 rounded-lg px-4 py-3 text-sm"
          style={{
            background: "#FEE2E2",
            color: "#991B1B",
            border: "1px solid #FECACA",
          }}
        >
          {lastError}
        </div>
      )}

      {status === "completed" && (
        <div className="mt-5">
          <Link
            href={`/projects/${slug}/versions/${versionId}`}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white"
            style={{ background: "var(--rr-accent)" }}
          >
            {t(locale, "viewPublished")}
          </Link>
        </div>
      )}

      <section className="mt-10">
        <h2
          className="mb-4 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--rr-text-muted)" }}
        >
          {zh ? "事件时间线" : "Event Timeline"}
        </h2>
        {events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--rr-text-muted)" }}>
            {zh ? "暂无事件记录。" : "No events recorded."}
          </p>
        ) : (
          <ol className="space-y-0.5">
            {events.map((event) => {
              const detail = eventDetail(event.type, event.payload ?? null, zh);
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 py-2 text-sm"
                >
                  <span
                    className="w-5 text-center font-mono"
                    style={{ color: "var(--rr-text-muted)" }}
                  >
                    {eventIcon(event.type)}
                  </span>
                  <span
                    className="w-24 shrink-0 font-mono text-xs"
                    style={{ color: "var(--rr-text-muted)" }}
                  >
                    {new Date(event.at).toLocaleTimeString(
                      zh ? "zh-CN" : "en-US",
                    )}
                  </span>
                  <span
                    className="font-medium"
                    style={{ color: "var(--rr-text)" }}
                  >
                    {event.type}
                  </span>
                  {event.pageSlug && (
                    <span style={{ color: "var(--rr-text-muted)" }}>
                      ({event.pageSlug})
                    </span>
                  )}
                  {detail && (
                    <span
                      className="ml-1 text-xs"
                      style={{ color: "var(--rr-accent)" }}
                    >
                      · {detail}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
