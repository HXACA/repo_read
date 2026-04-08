import { describe, it, expect } from "vitest";
import { resolveConfig } from "../resolver.js";
import type { UserEditableConfig } from "../../types/config.js";
import type { ModelCapability } from "../../types/provider.js";

const baseConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp/repo",
  preset: "quality",
  providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
  roles: {
    "main.author": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
    "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
    "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
  },
};

const capabilities: ModelCapability[] = [
  {
    model: "claude-opus-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: true, isLocalModel: false,
    health: "healthy", checkedAt: new Date().toISOString(),
  },
  {
    model: "claude-sonnet-4-6", provider: "anthropic",
    supportsStreaming: true, supportsToolCalls: true,
    supportsJsonSchema: true, supportsLongContext: true,
    supportsReasoningContent: false, isLocalModel: false,
    health: "healthy", checkedAt: new Date().toISOString(),
  },
];

describe("resolveConfig", () => {
  it("resolves roles with matching capabilities", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.roles["main.author"].primaryModel).toBe("claude-opus-4-6");
    expect(resolved.roles["main.author"].resolvedProvider).toBe("anthropic");
  });

  it("includes retrieval defaults for quality preset", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.retrieval.maxParallelReadsPerPage).toBe(2);
    expect(resolved.retrieval.allowControlledBash).toBe(true);
  });

  it("restricts retrieval for local-only preset", () => {
    const localConfig = { ...baseConfig, preset: "local-only" as const };
    const resolved = resolveConfig(localConfig, capabilities);
    expect(resolved.retrieval.maxParallelReadsPerPage).toBe(1);
  });

  it("assigns systemPromptTuningId based on model family", () => {
    const resolved = resolveConfig(baseConfig, capabilities);
    expect(resolved.roles["main.author"].systemPromptTuningId).toBe("anthropic-claude");
  });
});
