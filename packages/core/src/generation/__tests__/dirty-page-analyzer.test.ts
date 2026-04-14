import { describe, it, expect } from "vitest";
import { analyzeDirtyPages } from "../dirty-page-analyzer.js";
import type { DirtyPageAnalysisInput } from "../dirty-page-analyzer.js";

describe("analyzeDirtyPages", () => {
  it("marks a page dirty when a single changed file hits it", () => {
    const input: DirtyPageAnalysisInput = {
      changedFiles: ["src/foo.ts"],
      wiki: {
        reading_order: [
          { slug: "page-a", covered_files: ["src/foo.ts", "src/bar.ts"] },
          { slug: "page-b", covered_files: ["src/baz.ts"] },
        ],
      },
    };

    const result = analyzeDirtyPages(input);

    expect(result.dirtyPages).toEqual(["page-a"]);
    expect(result.unaffectedPages).toEqual(["page-b"]);
  });

  it("marks multiple pages dirty when a single file appears in both", () => {
    const input: DirtyPageAnalysisInput = {
      changedFiles: ["src/shared.ts"],
      wiki: {
        reading_order: [
          { slug: "page-a", covered_files: ["src/shared.ts", "src/a.ts"] },
          { slug: "page-b", covered_files: ["src/shared.ts", "src/b.ts"] },
          { slug: "page-c", covered_files: ["src/c.ts"] },
        ],
      },
    };

    const result = analyzeDirtyPages(input);

    expect(result.dirtyPages).toEqual(["page-a", "page-b"]);
    expect(result.unaffectedPages).toEqual(["page-c"]);
  });

  it("returns all pages unaffected when no files changed", () => {
    const input: DirtyPageAnalysisInput = {
      changedFiles: [],
      wiki: {
        reading_order: [
          { slug: "page-a", covered_files: ["src/a.ts"] },
          { slug: "page-b", covered_files: ["src/b.ts"] },
        ],
      },
    };

    const result = analyzeDirtyPages(input);

    expect(result.dirtyPages).toEqual([]);
    expect(result.unaffectedPages).toEqual(["page-a", "page-b"]);
  });

  it("returns all pages unaffected when changed file is not in any page", () => {
    const input: DirtyPageAnalysisInput = {
      changedFiles: ["src/orphan.ts"],
      wiki: {
        reading_order: [
          { slug: "page-a", covered_files: ["src/a.ts"] },
          { slug: "page-b", covered_files: ["src/b.ts"] },
        ],
      },
    };

    const result = analyzeDirtyPages(input);

    expect(result.dirtyPages).toEqual([]);
    expect(result.unaffectedPages).toEqual(["page-a", "page-b"]);
  });

  it("returns empty results when reading_order is empty", () => {
    const input: DirtyPageAnalysisInput = {
      changedFiles: ["src/foo.ts"],
      wiki: {
        reading_order: [],
      },
    };

    const result = analyzeDirtyPages(input);

    expect(result.dirtyPages).toEqual([]);
    expect(result.unaffectedPages).toEqual([]);
  });
});
