import { describe, it, expect, vi } from "vitest";
import { createModelForRole } from "../model-factory.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId, npm: "anthropic" }))),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => {
    const fn = vi.fn((modelId: string) => ({ modelId, npm: "openai-chat" })) as any;
    fn.responses = vi.fn((modelId: string) => ({ modelId, npm: "openai-responses" }));
    return fn;
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn((modelId: string) => ({ modelId, npm: "openai-compatible" }))),
}));

const mockConfig: ResolvedConfig = {
  projectSlug: "test",
  repoRoot: "/tmp",
  preset: "quality",
  language: "zh",
  roles: {
    "catalog": {
      role: "catalog",
      primaryModel: "anthropic/claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "anthropic-claude",
    },
    "outline": {
      role: "outline",
      primaryModel: "anthropic/claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "anthropic-claude",
    },
    "drafter": {
      role: "drafter",
      primaryModel: "anthropic/claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "anthropic-claude",
    },
    "worker": {
      role: "worker",
      primaryModel: "openrouter/qwen/qwen3.6-plus",
      fallbackModels: [],
      resolvedProvider: "openrouter",
      systemPromptTuningId: "generic-openai-compatible",
    },
    "reviewer": {
      role: "reviewer",
      primaryModel: "openai/gpt-5.4",
      fallbackModels: [],
      resolvedProvider: "openai",
      systemPromptTuningId: "openai-gpt",
    },
  },
  providers: [
    { provider: "anthropic", npm: "@ai-sdk/anthropic", secretRef: "ANTHROPIC_API_KEY", enabled: true, capabilities: [] },
    { provider: "openai", npm: "@ai-sdk/openai", secretRef: "OPENAI_API_KEY", enabled: true, capabilities: [] },
    { provider: "openrouter", npm: "@ai-sdk/openai-compatible", secretRef: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", enabled: true, capabilities: [] },
  ],
  retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
  qualityProfile: getQualityProfile("quality"),
};

describe("createModelForRole", () => {
  it("@ai-sdk/anthropic for anthropic/claude-*", () => {
    const model = createModelForRole(mockConfig, "catalog", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    expect((model as any).npm).toBe("anthropic");
    expect((model as any).modelId).toBe("claude-sonnet-4-6");
  });

  it("@ai-sdk/openai (.responses) for openai/gpt-*", () => {
    const model = createModelForRole(mockConfig, "reviewer", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    expect((model as any).npm).toBe("openai-responses");
    expect((model as any).modelId).toBe("gpt-5.4");
  });

  it("@ai-sdk/openai-compatible for openrouter/qwen/*", () => {
    const model = createModelForRole(mockConfig, "worker", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    expect((model as any).npm).toBe("openai-compatible");
    expect((model as any).modelId).toBe("qwen/qwen3.6-plus");
  });

  it("infers npm from provider name when npm field omitted", () => {
    const noNpmConfig = {
      ...mockConfig,
      providers: [{ provider: "anthropic", secretRef: "K", enabled: true, capabilities: [] as never[] }],
    };
    const model = createModelForRole(noNpmConfig, "catalog", { apiKeys: { anthropic: "sk" } });
    expect((model as any).npm).toBe("anthropic");
  });

  it("throws when API key is missing", () => {
    expect(() => createModelForRole(mockConfig, "catalog", { apiKeys: {} })).toThrow("No API key");
  });

  it("defaults to openai-compatible for unknown providers", () => {
    const customConfig = {
      ...mockConfig,
      roles: { ...mockConfig.roles, "catalog": { ...mockConfig.roles["catalog"], primaryModel: "deepseek/deepseek-v3", resolvedProvider: "deepseek" } },
      providers: [{ provider: "deepseek", secretRef: "K", enabled: true, capabilities: [] as never[] }],
    };
    const model = createModelForRole(customConfig, "catalog", { apiKeys: { deepseek: "sk" } });
    expect((model as any).npm).toBe("openai-compatible");
  });
});
