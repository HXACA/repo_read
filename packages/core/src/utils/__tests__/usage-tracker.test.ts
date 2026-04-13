import { describe, it, expect, beforeEach } from "vitest";
import { UsageTracker } from "../usage-tracker.js";
import type { UsageBucket } from "../usage-tracker.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function emptyBucket(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    requests: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UsageTracker
// ─────────────────────────────────────────────────────────────────────────────

describe("UsageTracker", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  // ── Test 2: starts empty ──────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts with all zeros in total", () => {
      const usage = tracker.getUsage();
      expect(usage.total).toEqual(emptyBucket());
    });

    it("starts with no role keys", () => {
      const usage = tracker.getUsage();
      expect(Object.keys(usage.byRole)).toHaveLength(0);
    });

    it("starts with no model keys", () => {
      const usage = tracker.getUsage();
      expect(Object.keys(usage.byModel)).toHaveLength(0);
    });
  });

  // ── Test 1: accumulates correctly ─────────────────────────────────────────

  describe("add()", () => {
    it("accumulates tokens by role correctly (2 adds to same role)", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 50,
        cachedTokens: 100,
      });
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 500,
        outputTokens: 100,
        reasoningTokens: 25,
        cachedTokens: 50,
      });

      const { byRole } = tracker.getUsage();
      expect(byRole["drafter"]).toEqual({
        inputTokens: 1500,
        outputTokens: 300,
        reasoningTokens: 75,
        cachedTokens: 150,
        requests: 2,
      });
    });

    it("accumulates tokens by model correctly", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 50,
        cachedTokens: 100,
      });
      tracker.add("reviewer", "gpt-5.4", {
        inputTokens: 800,
        outputTokens: 150,
        reasoningTokens: 0,
        cachedTokens: 200,
      });

      const { byModel } = tracker.getUsage();
      expect(byModel["gpt-5.4"]).toEqual({
        inputTokens: 1800,
        outputTokens: 350,
        reasoningTokens: 50,
        cachedTokens: 300,
        requests: 2,
      });
    });

    it("tracks different roles separately", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 0,
        cachedTokens: 0,
      });
      tracker.add("reviewer", "MiniMax", {
        inputTokens: 400,
        outputTokens: 80,
        reasoningTokens: 0,
        cachedTokens: 0,
      });

      const { byRole } = tracker.getUsage();
      expect(byRole["drafter"]?.requests).toBe(1);
      expect(byRole["reviewer"]?.requests).toBe(1);
      expect(byRole["drafter"]?.inputTokens).toBe(1000);
      expect(byRole["reviewer"]?.inputTokens).toBe(400);
    });

    it("tracks different models separately", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 0,
        cachedTokens: 0,
      });
      tracker.add("reviewer", "MiniMax", {
        inputTokens: 400,
        outputTokens: 80,
        reasoningTokens: 0,
        cachedTokens: 0,
      });

      const { byModel } = tracker.getUsage();
      expect(byModel["gpt-5.4"]?.inputTokens).toBe(1000);
      expect(byModel["MiniMax"]?.inputTokens).toBe(400);
    });

    it("accumulates total correctly across multiple adds", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 50,
        cachedTokens: 100,
      });
      tracker.add("reviewer", "MiniMax", {
        inputTokens: 400,
        outputTokens: 80,
        reasoningTokens: 0,
        cachedTokens: 0,
      });
      tracker.add("catalog", "gpt-5.4", {
        inputTokens: 300,
        outputTokens: 60,
        reasoningTokens: 10,
        cachedTokens: 20,
      });

      const { total } = tracker.getUsage();
      expect(total).toEqual({
        inputTokens: 1700,
        outputTokens: 340,
        reasoningTokens: 60,
        cachedTokens: 120,
        requests: 3,
      });
    });
  });

  // ── Test 3: JSON serialization ────────────────────────────────────────────

  describe("toJSON()", () => {
    it("serializes to valid JSON", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 50,
        cachedTokens: 100,
      });

      const json = tracker.toJSON();
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("serialized JSON contains byRole, byModel, and total keys", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 0,
        cachedTokens: 0,
      });

      const parsed = JSON.parse(tracker.toJSON());
      expect(parsed).toHaveProperty("byRole");
      expect(parsed).toHaveProperty("byModel");
      expect(parsed).toHaveProperty("total");
    });

    it("serialized JSON matches getUsage() output", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 500,
        outputTokens: 100,
        reasoningTokens: 20,
        cachedTokens: 50,
      });

      const parsed = JSON.parse(tracker.toJSON());
      const usage = tracker.getUsage();
      expect(parsed).toEqual(usage);
    });

    it("is formatted with 2-space indent", () => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 0,
        cachedTokens: 0,
      });

      const json = tracker.toJSON();
      // Presence of newline + 2 spaces indicates indented output
      expect(json).toContain("\n  ");
    });
  });

  // ── Test 4: formatDisplay() ───────────────────────────────────────────────

  describe("formatDisplay()", () => {
    beforeEach(() => {
      tracker.add("drafter", "gpt-5.4", {
        inputTokens: 2_572_615,
        outputTokens: 43_304,
        reasoningTokens: 22_183,
        cachedTokens: 1_100_416,
      });
      tracker.add("reviewer", "MiniMax", {
        inputTokens: 467_416,
        outputTokens: 46_155,
        reasoningTokens: 0,
        cachedTokens: 0,
      });
    });

    it("contains the header line", () => {
      expect(tracker.formatDisplay()).toContain("Token 用量:");
    });

    it("contains model names", () => {
      const display = tracker.formatDisplay();
      expect(display).toContain("gpt-5.4");
      expect(display).toContain("MiniMax");
    });

    it("contains formatted numbers with commas", () => {
      const display = tracker.formatDisplay();
      expect(display).toContain("2,572,615");
      expect(display).toContain("43,304");
      expect(display).toContain("22,183");
      expect(display).toContain("1,100,416");
      expect(display).toContain("467,416");
      expect(display).toContain("46,155");
    });

    it("contains total line", () => {
      expect(tracker.formatDisplay()).toContain("总计");
    });

    it("shows reasoning only when non-zero", () => {
      const display = tracker.formatDisplay();
      // gpt-5.4 line should have reasoning; MiniMax line should not
      const lines = display.split("\n");
      const gptLine = lines.find((l) => l.includes("gpt-5.4")) ?? "";
      const minimaxLine = lines.find((l) => l.includes("MiniMax")) ?? "";
      expect(gptLine).toContain("reasoning=");
      expect(minimaxLine).not.toContain("reasoning=");
    });

    it("shows cached only when non-zero", () => {
      const display = tracker.formatDisplay();
      const lines = display.split("\n");
      const gptLine = lines.find((l) => l.includes("gpt-5.4")) ?? "";
      const minimaxLine = lines.find((l) => l.includes("MiniMax")) ?? "";
      expect(gptLine).toContain("cached=");
      expect(minimaxLine).not.toContain("cached=");
    });

    it("shows request counts in parentheses", () => {
      const display = tracker.formatDisplay();
      expect(display).toContain("(1 reqs)");
    });

    it("total line includes sum of all tokens", () => {
      const display = tracker.formatDisplay();
      // total input = 2,572,615 + 467,416 = 3,040,031
      expect(display).toContain("3,040,031");
    });
  });
});
