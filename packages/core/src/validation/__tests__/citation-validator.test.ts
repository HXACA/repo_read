import { describe, it, expect } from "vitest";
import { validateCitations } from "../validators/citation-validator.js";
import type { CitationRecord } from "../../types/generation.js";

describe("validateCitations", () => {
  it("passes when all citations have valid targets", () => {
    const citations: CitationRecord[] = [
      { kind: "file", target: "src/engine.ts", locator: "1-50" },
      { kind: "page", target: "setup" },
    ];
    const result = validateCitations(citations, ["src/engine.ts", "src/pipeline.ts"], ["setup", "overview"], "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails when a file citation targets an unknown file", () => {
    const citations: CitationRecord[] = [{ kind: "file", target: "src/nonexistent.ts" }];
    const result = validateCitations(citations, ["src/engine.ts"], [], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("fails when a page citation targets an unknown page", () => {
    const citations: CitationRecord[] = [{ kind: "page", target: "missing-page" }];
    const result = validateCitations(citations, [], ["setup"], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-page"))).toBe(true);
  });

  it("warns when there are no citations", () => {
    const result = validateCitations([], ["src/engine.ts"], [], "test-page");
    expect(result.warnings.some((w) => w.includes("citation"))).toBe(true);
  });

  it("passes commit citations without file check", () => {
    const citations: CitationRecord[] = [{ kind: "commit", target: "abc123", note: "Initial commit" }];
    const result = validateCitations(citations, [], [], "test-page");
    expect(result.passed).toBe(true);
  });
});
