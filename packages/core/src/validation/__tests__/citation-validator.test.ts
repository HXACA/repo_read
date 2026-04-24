import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
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

  describe("file existence check (repoRoot)", () => {
    it("fails when a file citation points at a path that does not exist on disk", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-cite-"));
      try {
        fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "src/real.ts"), "// real\n");

        // CubeSandbox-style repro: both files appear in knownFiles (the
        // scope check can't reject them — catalog glob-expanded), but
        // only one actually exists on disk. The disk check MUST catch
        // the hallucinated one.
        const citations: CitationRecord[] = [
          { kind: "file", target: "src/real.ts", locator: "1-1" },
          { kind: "file", target: "src/hallucinated.ts", locator: "1-10" },
        ];
        const result = validateCitations(
          citations,
          ["src/real.ts", "src/hallucinated.ts"], // both in scope
          [],
          "test-page",
          { repoRoot: tmp },
        );
        expect(result.passed).toBe(false);
        const diskError = result.errors.find((e) =>
          e.includes("hallucinated.ts") && /does not exist/i.test(e),
        );
        expect(diskError).toBeDefined();
        // The real file should NOT produce a disk error.
        const realDiskError = result.errors.find((e) =>
          e.includes("real.ts") && /does not exist/i.test(e),
        );
        expect(realDiskError).toBeUndefined();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it("does not check disk when repoRoot is omitted (backwards compat)", () => {
      const citations: CitationRecord[] = [
        { kind: "file", target: "src/any.ts", locator: "1-10" },
      ];
      const result = validateCitations(
        citations,
        ["src/any.ts"],
        [],
        "test-page",
      );
      expect(result.passed).toBe(true);
    });

    it("passes when every file citation exists on disk", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-cite-"));
      try {
        fs.mkdirSync(path.join(tmp, "pkg"), { recursive: true });
        fs.writeFileSync(path.join(tmp, "pkg/a.go"), "package x\n");
        fs.writeFileSync(path.join(tmp, "pkg/b.go"), "package x\n");
        const citations: CitationRecord[] = [
          { kind: "file", target: "pkg/a.go", locator: "1-1" },
          { kind: "file", target: "pkg/b.go", locator: "1-1" },
        ];
        const result = validateCitations(
          citations,
          ["pkg/a.go", "pkg/b.go"],
          [],
          "test-page",
          { repoRoot: tmp },
        );
        expect(result.passed).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
