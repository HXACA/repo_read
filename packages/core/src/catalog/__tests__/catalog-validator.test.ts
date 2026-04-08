import { describe, it, expect } from "vitest";
import { validateCatalog } from "../catalog-validator.js";
import type { WikiJson } from "../../types/generation.js";

const valid: WikiJson = {
  summary: "A test project",
  reading_order: [
    { slug: "overview", title: "Overview", rationale: "Start", covered_files: ["README.md"] },
    { slug: "core", title: "Core", rationale: "Main", covered_files: ["src/index.ts"] },
  ],
};

describe("validateCatalog", () => {
  it("passes valid wiki.json", () => {
    const result = validateCatalog(valid);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails on missing summary", () => {
    const bad = { ...valid, summary: "" };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("fails on empty reading_order", () => {
    const bad = { ...valid, reading_order: [] };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("reading_order"))).toBe(true);
  });

  it("fails when exceeding 50 page limit", () => {
    const pages = Array.from({ length: 51 }, (_, i) => ({
      slug: `page-${i}`, title: `Page ${i}`, rationale: "test", covered_files: ["file.ts"],
    }));
    const big = { summary: "big", reading_order: pages };
    const result = validateCatalog(big);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("50"))).toBe(true);
  });

  it("fails on duplicate slugs", () => {
    const dup: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "overview", title: "A", rationale: "R", covered_files: ["a.ts"] },
        { slug: "overview", title: "B", rationale: "R", covered_files: ["b.ts"] },
      ],
    };
    const result = validateCatalog(dup);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("fails on empty slug", () => {
    const bad: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "", title: "No Slug", rationale: "R", covered_files: ["a.ts"] },
      ],
    };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
  });

  it("warns on pages with no covered_files", () => {
    const noFiles: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "intro", title: "Intro", rationale: "R", covered_files: [] },
        { slug: "other", title: "Other", rationale: "R", covered_files: ["b.ts"] },
      ],
    };
    const result = validateCatalog(noFiles);
    expect(result.warnings.some((w) => w.includes("covered_files"))).toBe(true);
  });

  it("fails on fewer than 2 pages", () => {
    const tiny: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "only", title: "Only", rationale: "R", covered_files: ["a.ts"] },
      ],
    };
    const result = validateCatalog(tiny);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("2"))).toBe(true);
  });
});
