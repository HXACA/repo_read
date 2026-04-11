import { describe, it, expect } from "vitest";

describe("ask command", () => {
  it("module exports runAsk function", async () => {
    const mod = await import("../../commands/ask.js");
    expect(typeof mod.runAsk).toBe("function");
  });
});
