import { describe, it, expect } from "vitest";
import { validateMermaid } from "../validators/mermaid-validator.js";

describe("validateMermaid", () => {
  it("passes page with no mermaid blocks", () => {
    const result = validateMermaid("# Title\n\nNo diagrams here.", "test-page");
    expect(result.passed).toBe(true);
  });

  it("passes valid mermaid flowchart", () => {
    const md = "# Title\n\n```mermaid\ngraph TD\n  A --> B\n  B --> C\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails on empty mermaid block", () => {
    const md = "# Title\n\n```mermaid\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("empty"))).toBe(true);
  });

  it("fails on mermaid block with no diagram type", () => {
    const md = "# Title\n\n```mermaid\nA --> B\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("passes valid sequence diagram", () => {
    const md = "# Title\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(true);
  });
});
