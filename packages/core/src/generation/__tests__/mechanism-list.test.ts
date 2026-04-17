import { describe, it, expect } from "vitest";
import { deriveMechanismList, type Mechanism } from "../mechanism-list.js";

type LedgerEntry = { id: string; kind: "file" | "page" | "commit"; target: string; note: string };

function L(target: string, note: string, id = target, kind: LedgerEntry["kind"] = "file"): LedgerEntry {
  return { id, kind, target, note };
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

  it("assigns must_cite when target is in coveredFiles, must_mention otherwise", () => {
    const ledger: LedgerEntry[] = [
      L("src/covered.ts", "inside scope"),
      L("src/helper.ts", "worker discovered"),
    ];
    const result = deriveMechanismList(ledger, ["src/covered.ts"]);
    expect(result.find((m) => m.citation.target === "src/covered.ts")!.coverageRequirement).toBe("must_cite");
    expect(result.find((m) => m.citation.target === "src/helper.ts")!.coverageRequirement).toBe("must_mention");
  });

  it("caps the list at 30 entries, longest descriptions first", () => {
    const ledger: LedgerEntry[] = [];
    for (let i = 0; i < 40; i++) {
      ledger.push(L(`src/file${i}.ts`, `note length ${i} ${"x".repeat(i)}`));
    }
    const result = deriveMechanismList(ledger, []);
    expect(result).toHaveLength(30);
    expect(result[0].description.length).toBeGreaterThanOrEqual(result[29].description.length);
  });

  it("truncates description at 120 chars", () => {
    const ledger: LedgerEntry[] = [L("src/a.ts", "a".repeat(300))];
    const result = deriveMechanismList(ledger, []);
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
