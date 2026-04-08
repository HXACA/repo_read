import type { ModelCapability } from "../types/provider.js";

type StaticModelEntry = Omit<ModelCapability, "checkedAt" | "health"> & {
  health?: ModelCapability["health"];
};

export const KNOWN_MODELS: Map<string, StaticModelEntry> = new Map([
  ["claude-opus-4-6", {
    model: "claude-opus-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: true, isLocalModel: false,
  }],
  ["claude-sonnet-4-6", {
    model: "claude-sonnet-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  ["claude-haiku-4-5-20251001", {
    model: "claude-haiku-4-5-20251001", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  ["gpt-4o", {
    model: "gpt-4o", provider: "openai",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
  ["gpt-4o-mini", {
    model: "gpt-4o-mini", provider: "openai",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
  }],
]);

export function getStaticCapabilities(
  model: string,
  provider: string,
): ModelCapability {
  const known = KNOWN_MODELS.get(model);
  if (known) {
    return {
      ...known,
      health: known.health ?? "healthy",
      checkedAt: new Date().toISOString(),
    };
  }

  const isLocal = provider === "openai-compatible" || provider === "ollama";
  return {
    model,
    provider,
    supportsStreaming: true,
    supportsToolCalls: false,
    supportsJsonSchema: false,
    supportsLongContext: false,
    supportsReasoningContent: false,
    isLocalModel: isLocal,
    health: "degraded",
    checkedAt: new Date().toISOString(),
  };
}
