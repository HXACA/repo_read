import { describe, it, expect } from "vitest";
import { validatePage } from "../page-validator.js";
import type { CitationRecord } from "../../types/generation.js";

const validMd = "# Core Engine\n\nThe engine orchestrates the generation pipeline. It manages state transitions and persists draft output.\n\n## Architecture\n\nThe pipeline follows a serial page model.\n\n```mermaid\ngraph TD\n  A[Catalog] --> B[Draft]\n  B --> C[Review]\n```";

const citations: CitationRecord[] = [
  { kind: "file", target: "src/engine.ts", locator: "1-50" },
];

describe("validatePage", () => {
  it("passes a fully valid page", () => {
    const result = validatePage({
      markdown: validMd,
      citations,
      knownFiles: ["src/engine.ts"],
      knownPages: ["setup"],
      pageSlug: "core-engine",
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("aggregates errors from multiple validators", () => {
    const result = validatePage({
      markdown: "",
      citations: [{ kind: "file", target: "nonexistent.ts" }],
      knownFiles: [],
      knownPages: [],
      pageSlug: "bad-page",
    });
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("aggregates warnings from multiple validators", () => {
    const shortMd = "# Title\n\nShort content.";
    const result = validatePage({
      markdown: shortMd,
      citations: [],
      knownFiles: [],
      knownPages: [],
      pageSlug: "short-page",
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("catches mermaid errors in combined validation", () => {
    const badMermaid = "# Title\n\nLong enough content to pass the minimum length requirement for structure validation checks and meet minimum length requirements.\n\n```mermaid\n```";
    const result = validatePage({
      markdown: badMermaid,
      citations: [{ kind: "file", target: "a.ts" }],
      knownFiles: ["a.ts"],
      knownPages: [],
      pageSlug: "mermaid-page",
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("mermaid"))).toBe(true);
  });
});
