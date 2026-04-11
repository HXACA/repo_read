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
    "main.author": {
      role: "main.author",
      primaryModel: "anthropic/claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "anthropic-claude",
    },
    "fork.worker": {
      role: "fork.worker",
      primaryModel: "openrouter/qwen/qwen3.6-plus",
      fallbackModels: [],
      resolvedProvider: "openrouter",
      systemPromptTuningId: "generic-openai-compatible",
    },
    "fresh.reviewer": {
      role: "fresh.reviewer",
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
    const model = createModelForRole(mockConfig, "main.author", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    expect((model as any).npm).toBe("anthropic");
    expect((model as any).modelId).toBe("claude-sonnet-4-6");
  });

  it("@ai-sdk/openai (.responses) for openai/gpt-*", () => {
    const model = createModelForRole(mockConfig, "fresh.reviewer", {
      apiKeys: { anthropic: "sk-ant", openai: "sk-oa", openrouter: "sk-or" },
    });
    expect((model as any).npm).toBe("openai-responses");
    expect((model as any).modelId).toBe("gpt-5.4");
  });

  it("@ai-sdk/openai-compatible for openrouter/qwen/*", () => {
    const model = createModelForRole(mockConfig, "fork.worker", {
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
    const model = createModelForRole(noNpmConfig, "main.author", { apiKeys: { anthropic: "sk" } });
    expect((model as any).npm).toBe("anthropic");
  });

  it("throws when API key is missing", () => {
    expect(() => createModelForRole(mockConfig, "main.author", { apiKeys: {} })).toThrow("No API key");
  });

  it("defaults to openai-compatible for unknown providers", () => {
    const customConfig = {
      ...mockConfig,
      roles: { ...mockConfig.roles, "main.author": { ...mockConfig.roles["main.author"], primaryModel: "deepseek/deepseek-v3", resolvedProvider: "deepseek" } },
      providers: [{ provider: "deepseek", secretRef: "K", enabled: true, capabilities: [] as never[] }],
    };
    const model = createModelForRole(customConfig, "main.author", { apiKeys: { deepseek: "sk" } });
    expect((model as any).npm).toBe("openai-compatible");
  });
});
