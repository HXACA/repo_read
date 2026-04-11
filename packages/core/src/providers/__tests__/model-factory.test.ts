import { describe, it, expect, vi } from "vitest";
import { createModelForRole } from "../model-factory.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

// Mock the AI SDK providers
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: "anthropic" }))),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => {
    const fn = vi.fn((modelId: string) => ({ modelId, provider: "openai" }));
    fn.responses = vi.fn((modelId: string) => ({ modelId, provider: "openai-responses" }));
    return fn;
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn((modelId: string) => ({ modelId, provider: "compatible" }))),
}));

const mockConfig: ResolvedConfig = {
  projectSlug: "test",
  repoRoot: "/tmp",
  preset: "quality",
  language: "zh",
  roles: {
    "main.author": {
      role: "main.author",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "fork.worker": {
      role: "fork.worker",
      primaryModel: "claude-haiku-4-5-20251001",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "fresh.reviewer": {
      role: "fresh.reviewer",
      primaryModel: "gpt-4o",
      fallbackModels: [],
      resolvedProvider: "openai",
      systemPromptTuningId: "openai",
    },
  },
  providers: [
    { provider: "anthropic", secretRef: "ANTHROPIC_API_KEY", enabled: true, capabilities: [] },
    { provider: "openai", secretRef: "OPENAI_API_KEY", enabled: true, capabilities: [] },
  ],
  retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
  qualityProfile: getQualityProfile("quality"),
};

describe("createModelForRole", () => {
  it("creates an Anthropic model for main.author", () => {
    const model = createModelForRole(mockConfig, "main.author", {
      apiKeys: { anthropic: "sk-ant-test", openai: "sk-test" },
    });
    expect(model).toBeDefined();
    expect((model as any).modelId).toBe("claude-sonnet-4-6");
  });

  it("creates an OpenAI model for fresh.reviewer", () => {
    const model = createModelForRole(mockConfig, "fresh.reviewer", {
      apiKeys: { anthropic: "sk-ant-test", openai: "sk-test" },
    });
    expect(model).toBeDefined();
    expect((model as any).modelId).toBe("gpt-4o");
  });

  it("throws when API key is missing", () => {
    expect(() =>
      createModelForRole(mockConfig, "main.author", { apiKeys: {} }),
    ).toThrow("No API key");
  });

  it("falls back to openai-compatible for unknown providers", () => {
    const customConfig = {
      ...mockConfig,
      roles: {
        ...mockConfig.roles,
        "main.author": {
          ...mockConfig.roles["main.author"],
          resolvedProvider: "deepseek",
        },
      },
    };
    const model = createModelForRole(customConfig, "main.author", {
      apiKeys: { deepseek: "sk-deep-test" },
    });
    expect(model).toBeDefined();
  });
});
