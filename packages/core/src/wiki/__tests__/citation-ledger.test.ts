import { describe, it, expect } from "vitest";
import { CitationLedger } from "../citation-ledger.js";

describe("CitationLedger", () => {
  it("tracks citations by page", () => {
    const ledger = new CitationLedger();
    ledger.addPage("overview", [
      { kind: "file", target: "src/index.ts", locator: "1-10" },
    ]);
    ledger.addPage("core", [
      { kind: "file", target: "src/engine.ts" },
      { kind: "file", target: "src/index.ts", locator: "20-30" },
    ]);

    expect(ledger.getForPage("overview")).toHaveLength(1);
    expect(ledger.getForPage("core")).toHaveLength(2);
    expect(ledger.getAll()).toHaveLength(2);
  });

  it("finds citations by target across pages", () => {
    const ledger = new CitationLedger();
    ledger.addPage("overview", [{ kind: "file", target: "src/index.ts" }]);
    ledger.addPage("core", [{ kind: "file", target: "src/index.ts" }]);

    const results = ledger.findByTarget("src/index.ts");
    expect(results).toHaveLength(2);
    expect(results[0].pageSlug).toBe("overview");
    expect(results[1].pageSlug).toBe("core");
  });

  it("returns empty for unknown page", () => {
    const ledger = new CitationLedger();
    expect(ledger.getForPage("unknown")).toEqual([]);
  });
});
