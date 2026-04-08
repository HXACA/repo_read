import { describe, it, expect } from "vitest";
import { getStaticCapabilities, KNOWN_MODELS } from "../capability.js";

describe("getStaticCapabilities", () => {
  it("returns capabilities for known Anthropic model", () => {
    const cap = getStaticCapabilities("claude-opus-4-6", "anthropic");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(true);
    expect(cap.supportsJsonSchema).toBe(true);
    expect(cap.supportsLongContext).toBe(true);
    expect(cap.health).toBe("healthy");
  });

  it("returns capabilities for known OpenAI model", () => {
    const cap = getStaticCapabilities("gpt-4o", "openai");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(true);
  });

  it("returns degraded for unknown model", () => {
    const cap = getStaticCapabilities("unknown-model-v1", "openai-compatible");
    expect(cap.health).toBe("degraded");
    expect(cap.supportsStreaming).toBe(true);
    expect(cap.supportsToolCalls).toBe(false);
  });

  it("marks local models correctly", () => {
    const cap = getStaticCapabilities("llama3", "openai-compatible");
    expect(cap.isLocalModel).toBe(true);
  });

  it("KNOWN_MODELS has entries for supported providers", () => {
    expect(KNOWN_MODELS.size).toBeGreaterThanOrEqual(4);
  });
});
