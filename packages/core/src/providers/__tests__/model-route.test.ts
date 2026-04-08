import { describe, it, expect } from "vitest";
import { buildFallbackChain } from "../model-route.js";
import type { ModelCapability } from "../../types/provider.js";

const healthy = (model: string, provider: string): ModelCapability => ({
  model, provider,
  supportsStreaming: true, supportsToolCalls: true,
  supportsJsonSchema: true, supportsLongContext: true,
  supportsReasoningContent: false, isLocalModel: false,
  health: "healthy", checkedAt: new Date().toISOString(),
});

const unavailable = (model: string, provider: string): ModelCapability => ({
  ...healthy(model, provider),
  health: "unavailable",
});

describe("buildFallbackChain", () => {
  it("returns primary model first when healthy", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      ["claude-sonnet-4-6"],
      [healthy("claude-opus-4-6", "anthropic"), healthy("claude-sonnet-4-6", "anthropic")],
    );
    expect(chain[0]).toBe("claude-opus-4-6");
    expect(chain[1]).toBe("claude-sonnet-4-6");
  });

  it("skips unavailable primary", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      ["claude-sonnet-4-6"],
      [unavailable("claude-opus-4-6", "anthropic"), healthy("claude-sonnet-4-6", "anthropic")],
    );
    expect(chain[0]).toBe("claude-sonnet-4-6");
    expect(chain).not.toContain("claude-opus-4-6");
  });

  it("returns empty chain when all unavailable", () => {
    const chain = buildFallbackChain(
      "claude-opus-4-6",
      [],
      [unavailable("claude-opus-4-6", "anthropic")],
    );
    expect(chain).toHaveLength(0);
  });
});
