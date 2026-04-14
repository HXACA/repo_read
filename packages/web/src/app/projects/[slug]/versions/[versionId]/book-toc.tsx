"use client";

import Link from "next/link";

type PageEntry = {
  slug: string;
  title: string;
  rationale?: string;
  section?: string;
  group?: string;
  level?: "beginner" | "intermediate" | "advanced";
  kind?: string;
};

type BookTOCProps = {
  pages: PageEntry[];
  projectSlug: string;
  versionId: string;
  currentPageSlug?: string;
};

/** Color scheme for kind badges. Falls back to neutral gray. */
function kindStyle(kind?: string): { bg: string; fg: string } {
  switch (kind) {
    case "guide":
      return { bg: "#DCFCE7", fg: "#166534" };
    case "explanation":
      return { bg: "#DBEAFE", fg: "#1E40AF" };
    case "reference":
      return { bg: "var(--rr-bg-surface)", fg: "var(--rr-text-muted)" };
    case "appendix":
      return { bg: "var(--rr-bg-surface)", fg: "var(--rr-text-muted)" };
    default:
      return { bg: "var(--rr-bg-surface)", fg: "var(--rr-text-secondary)" };
  }
}

/** Render level as dots: beginner=1, intermediate=2, advanced=3. */
function LevelDots({ level }: { level?: string }) {
  const count =
    level === "beginner" ? 1 : level === "intermediate" ? 2 : level === "advanced" ? 3 : 0;
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5"
      title={level}
      style={{ color: "var(--rr-text-muted)" }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--rr-text-muted)" }}
        />
      ))}
    </span>
  );
}

function KindBadge({ kind }: { kind?: string }) {
  if (!kind) return null;
  const style = kindStyle(kind);
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: style.bg, color: style.fg }}
    >
      {kind}
    </span>
  );
}

/**
 * Groups pages into ordered sections and sub-groups.
 * Preserves original reading_order within each group.
 */
function groupPages(pages: PageEntry[]) {
  const sections: {
    name: string;
    groups: { name: string; pages: { page: PageEntry; globalIdx: number }[] }[];
  }[] = [];

  const sectionOrder: string[] = [];
  const sectionMap = new Map<
    string,
    Map<string, { page: PageEntry; globalIdx: number }[]>
  >();

  pages.forEach((page, idx) => {
    const sectionName = page.section ?? "";
    const groupName = page.group ?? "";

    if (!sectionMap.has(sectionName)) {
      sectionMap.set(sectionName, new Map());
      sectionOrder.push(sectionName);
    }
    const groupMap = sectionMap.get(sectionName)!;
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, []);
    }
    groupMap.get(groupName)!.push({ page, globalIdx: idx });
  });

  for (const sectionName of sectionOrder) {
    const groupMap = sectionMap.get(sectionName)!;
    const groups: { name: string; pages: { page: PageEntry; globalIdx: number }[] }[] = [];
    for (const [groupName, groupPages] of groupMap) {
      groups.push({ name: groupName, pages: groupPages });
    }
    sections.push({ name: sectionName, groups });
  }

  return sections;
}

export function BookTOC({
  pages,
  projectSlug,
  versionId,
  currentPageSlug,
}: BookTOCProps) {
  const sections = groupPages(pages);

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <div key={section.name || "__ungrouped__"}>
          {section.name && (
            <h3
              className="mb-3 text-sm font-semibold uppercase tracking-wider"
              style={{ color: "var(--rr-text-secondary)" }}
            >
              {section.name}
            </h3>
          )}
          {section.groups.map((group) => (
            <div key={group.name || "__nogroup__"} className="mb-4">
              {group.name && (
                <h4
                  className="mb-2 text-xs font-medium uppercase tracking-wider"
                  style={{
                    color: "var(--rr-text-muted)",
                    paddingLeft: "0.25rem",
                  }}
                >
                  {group.name}
                </h4>
              )}
              <ol className="space-y-2">
                {group.pages.map(({ page, globalIdx }) => {
                  const isActive = page.slug === currentPageSlug;
                  const isDeemphasized =
                    page.kind === "appendix" || page.kind === "reference";
                  return (
                    <li key={page.slug}>
                      <Link
                        href={`/projects/${projectSlug}/versions/${versionId}/pages/${page.slug}`}
                        className="group flex items-start gap-4 rounded-lg px-4 py-3.5 transition-colors"
                        style={{
                          border: isActive
                            ? "1.5px solid var(--rr-accent)"
                            : "1px solid var(--rr-border)",
                          background: isActive
                            ? "var(--rr-accent-subtle)"
                            : "var(--rr-bg-elevated)",
                          opacity: isDeemphasized && !isActive ? 0.75 : 1,
                        }}
                      >
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold"
                          style={{
                            background: isActive
                              ? "var(--rr-accent)"
                              : "var(--rr-accent-subtle)",
                            color: isActive
                              ? "white"
                              : "var(--rr-accent)",
                            fontFamily: "var(--font-mono), monospace",
                          }}
                        >
                          {String(globalIdx + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3
                              className="font-medium"
                              style={{
                                fontFamily:
                                  "var(--font-display), Georgia, serif",
                                color: isActive
                                  ? "var(--rr-accent)"
                                  : "var(--rr-text)",
                                fontSize: isDeemphasized
                                  ? "0.875rem"
                                  : "1rem",
                              }}
                            >
                              {page.title}
                            </h3>
                            <KindBadge kind={page.kind} />
                            <LevelDots level={page.level} />
                          </div>
                          {page.rationale && (
                            <p
                              className="mt-0.5 truncate text-sm leading-snug"
                              style={{ color: "var(--rr-text-muted)" }}
                            >
                              {page.rationale}
                            </p>
                          )}
                        </div>
                        <span
                          className="mt-1 shrink-0 text-sm opacity-0 transition-opacity group-hover:opacity-70"
                          style={{ color: "var(--rr-accent)" }}
                        >
                          &rarr;
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
