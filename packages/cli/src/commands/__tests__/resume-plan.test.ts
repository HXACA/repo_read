import { describe, it, expect } from "vitest";
import { buildResumePlan } from "../resume-plan.js";
import type { WikiJson, PageMeta } from "@reporead/core";

function wiki(slugs: string[]): WikiJson {
  return {
    summary: "",
    reading_order: slugs.map((slug, i) => ({
      slug,
      title: `Title ${i}`,
      rationale: "",
      covered_files: [],
    })),
  };
}

function pageMeta(overrides: Partial<PageMeta>): PageMeta {
  return {
    slug: overrides.slug ?? "p",
    title: overrides.title ?? "T",
    order: overrides.order ?? 0,
    sectionId: overrides.sectionId ?? "sec",
    coveredFiles: overrides.coveredFiles ?? [],
    relatedPages: overrides.relatedPages ?? [],
    generatedAt: overrides.generatedAt ?? new Date(0).toISOString(),
    commitHash: overrides.commitHash ?? "deadbeef",
    citationFile: overrides.citationFile ?? "cites.json",
    ...overrides,
  } as PageMeta;
}

describe("buildResumePlan", () => {
  it("publish-only branch: every page validated → publishOnly=true, remaining=0", async () => {
    const w = wiki(["a", "b", "c"]);
    const metas: Record<string, PageMeta> = {
      a: pageMeta({ slug: "a", status: "validated", commitHash: "c1" }),
      b: pageMeta({ slug: "b", status: "validated", commitHash: "c1" }),
      c: pageMeta({ slug: "c", status: "validated", commitHash: "c1" }),
    };
    const plan = await buildResumePlan(w, async (s) => metas[s] ?? null);

    expect(plan.publishOnly).toBe(true);
    expect(plan.alreadyDone).toBe(3);
    expect(plan.remaining).toBe(0);
    expect(plan.skipPageSlugs).toEqual(new Set(["a", "b", "c"]));
    expect(plan.recoveredCommitHash).toBe("c1");
  });

  it("mixed: validated pages skipped, others kept", async () => {
    const w = wiki(["a", "b", "c", "d"]);
    const metas: Record<string, PageMeta | null> = {
      a: pageMeta({ slug: "a", status: "validated", commitHash: "c1" }),
      b: pageMeta({ slug: "b", status: "drafting", commitHash: "c1" }),
      c: null,
      d: pageMeta({ slug: "d", status: "validated", commitHash: "c2" }),
    };
    const plan = await buildResumePlan(w, async (s) => metas[s] ?? null);

    expect(plan.publishOnly).toBe(false);
    expect(plan.alreadyDone).toBe(2);
    expect(plan.remaining).toBe(2);
    expect(plan.skipPageSlugs).toEqual(new Set(["a", "d"]));
    // First validated page's commit hash wins
    expect(plan.recoveredCommitHash).toBe("c1");
  });

  it("fresh resume: no validated pages → skipPageSlugs empty, no commit recovered", async () => {
    const w = wiki(["a", "b"]);
    const plan = await buildResumePlan(w, async () => null);

    expect(plan.publishOnly).toBe(false);
    expect(plan.alreadyDone).toBe(0);
    expect(plan.remaining).toBe(2);
    expect(plan.skipPageSlugs.size).toBe(0);
    expect(plan.recoveredCommitHash).toBe(null);
  });

  it("empty reading order → publishOnly=true (trivially) but no skips", async () => {
    const w = wiki([]);
    const plan = await buildResumePlan(w, async () => null);

    expect(plan.publishOnly).toBe(true);
    expect(plan.alreadyDone).toBe(0);
    expect(plan.remaining).toBe(0);
  });

  it("non-validated statuses (rejected, drafting, truncated) never skip", async () => {
    const w = wiki(["a", "b", "c"]);
    const metas: Record<string, PageMeta> = {
      a: pageMeta({ slug: "a", status: "rejected", commitHash: "c1" }),
      b: pageMeta({ slug: "b", status: "drafting", commitHash: "c1" }),
      // "truncated" isn't in the type union but defensive code should still
      // treat anything that isn't exactly "validated" as not-skippable.
      c: pageMeta({ slug: "c", status: "truncated" as PageMeta["status"], commitHash: "c1" }),
    };
    const plan = await buildResumePlan(w, async (s) => metas[s] ?? null);

    expect(plan.alreadyDone).toBe(0);
    expect(plan.remaining).toBe(3);
    expect(plan.skipPageSlugs.size).toBe(0);
    expect(plan.recoveredCommitHash).toBe(null);
  });

  it("skips pages with validated meta but falls back to next for commit hash if first has no hash", async () => {
    const w = wiki(["a", "b"]);
    const metas: Record<string, PageMeta> = {
      // hash missing on first validated page — loop should keep looking
      a: pageMeta({ slug: "a", status: "validated", commitHash: "" }),
      b: pageMeta({ slug: "b", status: "validated", commitHash: "c2" }),
    };
    const plan = await buildResumePlan(w, async (s) => metas[s] ?? null);

    expect(plan.publishOnly).toBe(true);
    expect(plan.recoveredCommitHash).toBe("c2");
  });

  it("iterates in reading-order so first validated page determines commit", async () => {
    const w = wiki(["z", "a", "m"]); // order-preserving
    const metas: Record<string, PageMeta> = {
      z: pageMeta({ slug: "z", status: "validated", commitHash: "hash-z" }),
      a: pageMeta({ slug: "a", status: "validated", commitHash: "hash-a" }),
      m: pageMeta({ slug: "m", status: "validated", commitHash: "hash-m" }),
    };
    const plan = await buildResumePlan(w, async (s) => metas[s] ?? null);

    expect(plan.recoveredCommitHash).toBe("hash-z");
  });
});
