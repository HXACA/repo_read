import { describe, it, expect } from "vitest";
import { validateStructure } from "../validators/structure-validator.js";

describe("validateStructure", () => {
  it("passes valid page markdown", () => {
    const md = "# Page Title\n\nSome content with a paragraph.\n\n## Section\n\nMore content.";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when H1 title is missing", () => {
    const md = "## Section\n\nContent without a title.";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("H1"))).toBe(true);
  });

  it("fails on empty content", () => {
    const md = "";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(false);
  });

  it("warns on very short content", () => {
    const md = "# Title\n\nShort.";
    const result = validateStructure(md, "test-page");
    expect(result.warnings.some((w) => w.includes("short"))).toBe(true);
  });

  it("passes page with code blocks and lists", () => {
    const md = "# Title\n\nIntro paragraph.\n\n## Code\n\n```ts\nconst x = 1;\n```\n\n- item 1\n- item 2";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(true);
  });
});
