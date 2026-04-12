import { describe, it, expect } from "vitest";
import { computeComplexity } from "../complexity-scorer.js";

describe("computeComplexity", () => {
  it("scores a simple page low", () => {
    const score = computeComplexity({ coveredFiles: ["README.md"] });
    expect(score.fileCount).toBe(1);
    expect(score.dirSpread).toBe(1);
    expect(score.crossLanguage).toBe(false);
    expect(score.score).toBeLessThan(5);
  });

  it("scores a complex page high", () => {
    const score = computeComplexity({
      coveredFiles: ["src/api/routes.ts", "src/api/middleware.ts", "src/services/auth.ts", "src/models/user.py", "lib/utils/helpers.js", "config/settings.yaml", "tests/api/routes.test.ts", "docs/api.md"],
    });
    expect(score.fileCount).toBe(8);
    expect(score.dirSpread).toBeGreaterThan(3);
    expect(score.crossLanguage).toBe(true);
    expect(score.score).toBeGreaterThan(10);
  });

  it("detects cross-language", () => {
    const score = computeComplexity({ coveredFiles: ["main.go", "handler.go", "test.py"] });
    expect(score.crossLanguage).toBe(true);
  });

  it("single language is not cross-language", () => {
    const score = computeComplexity({ coveredFiles: ["src/a.ts", "src/b.tsx", "lib/c.js"] });
    expect(score.crossLanguage).toBe(false);
  });
});
