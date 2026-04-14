import { describe, it, expect } from "vitest";
import { isPageKind, PAGE_KINDS } from "../page-kind.js";

describe("PageKind", () => {
  it("accepts all 4 valid kinds", () => {
    for (const kind of PAGE_KINDS) {
      expect(isPageKind(kind)).toBe(true);
    }
  });

  it("rejects invalid strings", () => {
    expect(isPageKind("tutorial")).toBe(false);
    expect(isPageKind("howto")).toBe(false);
    expect(isPageKind("")).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isPageKind(null)).toBe(false);
    expect(isPageKind(undefined)).toBe(false);
  });

  it("rejects non-string types", () => {
    expect(isPageKind(42)).toBe(false);
    expect(isPageKind({})).toBe(false);
    expect(isPageKind([])).toBe(false);
    expect(isPageKind(true)).toBe(false);
  });
});
