import { describe, it, expect } from "vitest";
import { validateCatalog } from "../catalog-validator.js";
import type { WikiJson } from "../../types/generation.js";

/**
 * Helper to build a valid 4-kind wiki catalog for testing.
 */
function makeBookCatalog(overrides?: Partial<WikiJson>): WikiJson {
  return {
    summary: "A TypeScript monorepo for generating source-code explanation books",
    reading_order: [
      {
        slug: "getting-started",
        title: "Getting Started",
        kind: "guide",
        readerGoal: "Set up the project and run the first generation",
        rationale: "Entry point for new readers",
        covered_files: ["src/index.ts", "src/cli.ts"],
        prerequisites: [],
        section: "Introduction",
        level: "beginner",
      },
      {
        slug: "architecture-overview",
        title: "Architecture Overview",
        kind: "explanation",
        readerGoal: "Understand the high-level architecture and data flow",
        rationale: "Core architecture understanding",
        covered_files: ["src/core/pipeline.ts", "src/core/engine.ts"],
        prerequisites: ["getting-started"],
        section: "Core Concepts",
        level: "intermediate",
      },
      {
        slug: "catalog-system",
        title: "The Catalog System",
        kind: "explanation",
        readerGoal: "Understand how the catalog planner produces a book plan",
        rationale: "Deep dive into catalog planning",
        covered_files: ["src/catalog/catalog-planner.ts", "src/catalog/catalog-prompt.ts"],
        prerequisites: ["architecture-overview"],
        section: "Core Concepts",
        level: "intermediate",
      },
      {
        slug: "configuration-reference",
        title: "Configuration Reference",
        kind: "reference",
        readerGoal: "Look up all configuration options and their defaults",
        rationale: "Complete config reference",
        covered_files: ["src/config/schema.ts", "src/config/defaults.ts"],
        prerequisites: ["getting-started"],
        section: "Reference",
        level: "intermediate",
      },
      {
        slug: "edge-cases-and-migration",
        title: "Edge Cases & Migration Notes",
        kind: "appendix",
        readerGoal: "Handle edge cases and migrate from older versions",
        rationale: "Long-tail content for advanced users",
        covered_files: ["src/migration/v1-to-v2.ts"],
        prerequisites: ["architecture-overview"],
        section: "Appendix",
        level: "advanced",
      },
    ],
    ...overrides,
  };
}

describe("book catalog schema validation", () => {
  it("valid 4-kind catalog passes validation", () => {
    const wiki = makeBookCatalog();
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    // No book-schema warnings because all fields are valid
    const bookWarnings = result.warnings.filter(
      (w) => w.includes("kind") || w.includes("readerGoal") || w.includes("guide") || w.includes("appendix") || w.includes("reference"),
    );
    expect(bookWarnings).toHaveLength(0);
  });

  it("invalid kind triggers warning", () => {
    const wiki = makeBookCatalog();
    // Force an invalid kind
    (wiki.reading_order[1] as Record<string, unknown>).kind = "tutorial";
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true); // warnings don't fail validation
    expect(result.warnings.some((w) => w.includes('invalid kind "tutorial"'))).toBe(true);
  });

  it("missing kind triggers warning", () => {
    const wiki = makeBookCatalog();
    delete (wiki.reading_order[1] as Record<string, unknown>).kind;
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes("missing kind"))).toBe(true);
  });

  it("missing readerGoal triggers warning", () => {
    const wiki = makeBookCatalog();
    delete (wiki.reading_order[2] as Record<string, unknown>).readerGoal;
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes("missing readerGoal"))).toBe(true);
  });

  it("empty readerGoal triggers warning", () => {
    const wiki = makeBookCatalog();
    wiki.reading_order[2].readerGoal = "  ";
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes("missing readerGoal"))).toBe(true);
  });

  it("first page not being guide triggers warning", () => {
    const wiki = makeBookCatalog();
    wiki.reading_order[0].kind = "explanation";
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes('First page should be kind "guide"'))).toBe(true);
  });

  it("appendix in first 20% triggers warning", () => {
    const wiki = makeBookCatalog();
    // With 5 pages, first 20% = ceil(5*0.2) = 1 page (index 0)
    wiki.reading_order[0].kind = "appendix";
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes("appendix should not appear in the first 20%"))).toBe(true);
  });

  it("appendix at index 1 of a 5-page catalog does not trigger 20% warning", () => {
    const wiki = makeBookCatalog();
    // ceil(5*0.2)=1, so only index 0 is in the first 20%. Index 1 is fine.
    wiki.reading_order[1].kind = "appendix";
    const result = validateCatalog(wiki);
    const appendixWarnings = result.warnings.filter((w) => w.includes("appendix should not appear in the first 20%"));
    expect(appendixWarnings).toHaveLength(0);
  });

  it("reference before first explanation triggers warning", () => {
    const wiki = makeBookCatalog();
    // Make the first page a reference and second page the first explanation
    wiki.reading_order[0].kind = "reference";
    wiki.reading_order[1].kind = "explanation";
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(true);
    expect(result.warnings.some((w) => w.includes("reference should not appear before the first explanation"))).toBe(true);
  });

  // Existing validation rules still work

  it("fails on missing summary (existing rule)", () => {
    const wiki = makeBookCatalog({ summary: "" });
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("fails on duplicate slugs (existing rule)", () => {
    const wiki = makeBookCatalog();
    wiki.reading_order[1].slug = wiki.reading_order[0].slug;
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("fails on fewer than 2 pages (existing rule)", () => {
    const wiki = makeBookCatalog();
    wiki.reading_order = [wiki.reading_order[0]];
    const result = validateCatalog(wiki);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("2"))).toBe(true);
  });

  it("warns on empty covered_files (existing rule)", () => {
    const wiki = makeBookCatalog();
    wiki.reading_order[0].covered_files = [];
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("covered_files"))).toBe(true);
  });

  // Section/level validation

  it("missing section triggers warning", () => {
    const wiki = makeBookCatalog();
    delete (wiki.reading_order[1] as Record<string, unknown>).section;
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("missing section"))).toBe(true);
  });

  it("missing level triggers warning", () => {
    const wiki = makeBookCatalog();
    delete (wiki.reading_order[1] as Record<string, unknown>).level;
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("missing level"))).toBe(true);
  });

  // Kind diversity

  it("no guide pages triggers warning", () => {
    const wiki = makeBookCatalog();
    for (const p of wiki.reading_order) {
      if (p.kind === "guide") p.kind = "explanation";
    }
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("No guide pages"))).toBe(true);
  });

  it("no explanation pages triggers warning", () => {
    const wiki = makeBookCatalog();
    for (const p of wiki.reading_order) {
      if (p.kind === "explanation") p.kind = "guide";
    }
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("No explanation pages"))).toBe(true);
  });

  it("no reference or appendix triggers warning", () => {
    const wiki = makeBookCatalog();
    for (const p of wiki.reading_order) {
      if (p.kind === "reference" || p.kind === "appendix") p.kind = "explanation";
    }
    const result = validateCatalog(wiki);
    expect(result.warnings.some((w) => w.includes("No reference or appendix"))).toBe(true);
  });
});
