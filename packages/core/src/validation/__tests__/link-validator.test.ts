import { describe, it, expect } from "vitest";
import { validateLinks } from "../validators/link-validator.js";

describe("validateLinks", () => {
  it("passes page with valid internal page links", () => {
    const md = "# Title\n\nSee [Setup](setup) for details.";
    const result = validateLinks(md, ["setup", "overview"], "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails when internal link targets unknown page", () => {
    const md = "# Title\n\nSee [Missing](missing-page) for details.";
    const result = validateLinks(md, ["setup"], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-page"))).toBe(true);
  });

  it("ignores external URLs", () => {
    const md = "# Title\n\nSee [Docs](https://example.com) for details.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });

  it("ignores anchor links", () => {
    const md = "# Title\n\nSee [Section](#section) below.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });

  it("passes page with no links", () => {
    const md = "# Title\n\nNo links here.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });
});
