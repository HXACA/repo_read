import { describe, it, expect } from "vitest";
import { deriveMechanismList, type Mechanism } from "../mechanism-list.js";

type LedgerEntry = {
  id: string;
  kind: "file" | "page" | "commit";
  target: string;
  locator?: string;
  note: string;
};

function L(
  target: string,
  note: string,
  id = target,
  kind: LedgerEntry["kind"] = "file",
  locator?: string,
): LedgerEntry {
  return { id, kind, target, note, ...(locator ? { locator } : {}) };
}

describe("deriveMechanismList", () => {
  it("returns empty array when ledger is empty", () => {
    expect(deriveMechanismList([], [])).toEqual([]);
  });

  it("filters out entries with empty note (trivial citations)", () => {
    const ledger: LedgerEntry[] = [
      L("src/a.ts", ""),
      L("src/b.ts", "  "),
      L("src/c.ts", "defines Foo class"),
    ];
    const result = deriveMechanismList(ledger, ["src/c.ts"]);
    expect(result.map((m) => m.citation.target)).toEqual(["src/c.ts"]);
  });

  it("deduplicates by citation.target, keeps first entry", () => {
    const ledger: LedgerEntry[] = [
      L("src/a.ts", "first note"),
      L("src/a.ts", "second note"),
      L("src/b.ts", "b note"),
    ];
    const result = deriveMechanismList(ledger, ["src/a.ts", "src/b.ts"]);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.citation.target === "src/a.ts")!.description).toBe("first note");
  });

  it("keeps file entries inside coveredFiles as must_cite", () => {
    const ledger: LedgerEntry[] = [L("src/covered.ts", "inside scope")];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result).toHaveLength(1);
    expect(result[0].coverageRequirement).toBe("must_cite");
  });

  it("scope check uses plain target, unaffected by locator suffix", () => {
    // Real-world regression: evidence-coordinator now writes locator as a
    // separate field, so deriveMechanismList compares coveredFiles against
    // entry.target (the plain path). Previously targets were fused
    // ("src/covered.ts:10-20") and the check silently failed.
    const ledger: LedgerEntry[] = [
      L("src/covered.ts", "first citation", "1", "file", "10-20"),
      L("src/covered.ts", "second citation", "2", "file", "45-60"),
    ];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result).toHaveLength(2);
    expect(result.every((m) => m.coverageRequirement === "must_cite")).toBe(true);
    // Same target, different locator → both kept as distinct mechanisms.
    // Output is sorted by description length so compare via set.
    expect(new Set(result.map((m) => m.citation.locator))).toEqual(new Set(["10-20", "45-60"]));
  });

  it("still dedups when kind+target+locator are identical", () => {
    const ledger: LedgerEntry[] = [
      L("src/covered.ts", "first note", "1", "file", "10-20"),
      L("src/covered.ts", "duplicate (same loc)", "2", "file", "10-20"),
      L("src/covered.ts", "distinct range", "3", "file", "30-40"),
    ];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result).toHaveLength(2);
    // First-wins dedup keeps the earlier description for the duplicate pair
    const tenTwenty = result.find((m) => m.citation.locator === "10-20");
    expect(tenTwenty?.description).toBe("first note");
  });

  it("drops file entries whose target is outside coveredFiles", () => {
    // Prevents unrecoverable missing_coverage findings — drafter's Citation
    // Guard blocks files outside coveredFiles, so reviewers can never see
    // these mechanisms resolved. Dropping them upstream avoids wasted
    // revision cycles.
    const ledger: LedgerEntry[] = [
      L("src/covered.ts", "inside scope"),
      L("src/helper.ts", "worker discovered — out of scope"),
      L("src/util.ts", "another out-of-scope file"),
    ];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result.map((m) => m.citation.target)).toEqual(["src/covered.ts"]);
  });

  it("keeps page/commit entries regardless of coveredFiles", () => {
    // Cross-page/commit citations are reference pointers, not scope-bound
    // source citations, so they are not subject to Citation Guard blocking.
    const ledger: LedgerEntry[] = [
      { id: "1", kind: "page", target: "other-page", note: "related page" },
      { id: "2", kind: "commit", target: "abc1234", note: "background commit" },
    ];
    const result = deriveMechanismList(ledger, ["src/something-unrelated.ts"]);
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.citation.kind === "page")!.citation.target).toBe("other-page");
    expect(result.find((m) => m.citation.kind === "commit")!.citation.target).toBe("abc1234");
    // Both get must_mention because their targets are not file paths
    expect(result.every((m) => m.coverageRequirement === "must_mention")).toBe(true);
  });

  it("caps the list at 30 entries, longest descriptions first", () => {
    const ledger: LedgerEntry[] = [];
    const covered: string[] = [];
    for (let i = 0; i < 40; i++) {
      const t = `src/file${i}.ts`;
      ledger.push(L(t, `note length ${i} ${"x".repeat(i)}`));
      covered.push(t);
    }
    const result = deriveMechanismList(ledger, covered);
    expect(result).toHaveLength(30);
    expect(result[0].description.length).toBeGreaterThanOrEqual(result[29].description.length);
  });

  it("truncates description at 120 chars", () => {
    const ledger: LedgerEntry[] = [L("src/a.ts", "a".repeat(300))];
    const result = deriveMechanismList(ledger, ["src/a.ts"]);
    expect(result[0].description.length).toBe(120);
  });

  it("builds id with kind, target, and optional locator", () => {
    const ledger: LedgerEntry[] = [
      { id: "1", kind: "file", target: "src/publisher.ts", note: "publishes versions" },
    ];
    const result = deriveMechanismList(ledger, ["src/publisher.ts"]);
    expect(result[0].id).toBe("file:src/publisher.ts");
  });

  it("returns Mechanism objects with citation preserving kind", () => {
    const ledger: LedgerEntry[] = [
      { id: "1", kind: "page", target: "other-page-slug", note: "related page" },
    ];
    const result: Mechanism[] = deriveMechanismList(ledger, []);
    expect(result[0].citation.kind).toBe("page");
    expect(result[0].citation.target).toBe("other-page-slug");
  });
});
