import { describe, it, expect, vi } from "vitest";
import { createModelForRole } from "../model-factory.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

// Mock the AI SDK providers
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn((modelId: string) => ({ modelId, sdk: "anthropic" }))),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => {
    const fn = vi.fn((modelId: string) => ({ modelId, sdk: "openai" }));
    fn.responses = vi.fn((modelId: string) => ({ modelId, sdk: "openai-responses" }));
    return fn;
  }),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn((modelId: string) => ({ modelId, sdk: "openai-compatible" }))),
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
      primaryModel: "qwen/qwen3.6-plus",
      fallbackModels: [],
      resolvedProvider: "openrouter",
      systemPromptTuningId: "generic-openai-compatible",
    },
    "fresh.reviewer": {
      role: "fresh.reviewer",
      primaryModel: "gpt-4o",
      fallbackModels: [],
      resolvedProvider: "openai",
      systemPromptTuningId: "openai-gpt",
    },
  },
  providers: [
    { provider: "anthropic", sdk: "@ai-sdk/anthropic", secretRef: "ANTHROPIC_API_KEY", enabled: true, capabilities: [] },
    { provider: "openai", sdk: "@ai-sdk/openai:responses", secretRef: "OPENAI_API_KEY", enabled: true, capabilities: [] },
    { provider: "openrouter", sdk: "@ai-sdk/openai-compatible", secretRef: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1", enabled: true, capabilities: [] },
  ],
  retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
  qualityProfile: getQualityProfile("quality"),
};

describe("createModelForRole", () => {
  it("uses @ai-sdk/anthropic when sdk is declared", () => {
    const model = createModelForRole(mockConfig, "main.author", {
      apiKeys: { anthropic: "sk-ant-test", openai: "sk-test", openrouter: "sk-or-test" },
    });
    expect((model as any).sdk).toBe("anthropic");
    expect((model as any).modelId).toBe("claude-sonnet-4-6");
  });

  it("uses @ai-sdk/openai:responses when sdk is declared", () => {
    const model = createModelForRole(mockConfig, "fresh.reviewer", {
      apiKeys: { anthropic: "sk-ant-test", openai: "sk-test", openrouter: "sk-or-test" },
    });
    expect((model as any).sdk).toBe("openai-responses");
    expect((model as any).modelId).toBe("gpt-4o");
  });

  it("uses @ai-sdk/openai-compatible when sdk is declared", () => {
    const model = createModelForRole(mockConfig, "fork.worker", {
      apiKeys: { anthropic: "sk-ant-test", openai: "sk-test", openrouter: "sk-or-test" },
    });
    expect((model as any).sdk).toBe("openai-compatible");
    expect((model as any).modelId).toBe("qwen/qwen3.6-plus");
  });

  it("infers sdk from provider name when sdk is omitted", () => {
    const configNoSdk = {
      ...mockConfig,
      providers: [
        { provider: "anthropic", secretRef: "ANTHROPIC_API_KEY", enabled: true, capabilities: [] as never[] },
      ],
    };
    const model = createModelForRole(configNoSdk, "main.author", {
      apiKeys: { anthropic: "sk-ant-test" },
    });
    expect((model as any).sdk).toBe("anthropic");
  });

  it("throws when API key is missing", () => {
    expect(() =>
      createModelForRole(mockConfig, "main.author", { apiKeys: {} }),
    ).toThrow("No API key");
  });

  it("defaults to openai-compatible for unknown providers without sdk", () => {
    const customConfig = {
      ...mockConfig,
      roles: {
        ...mockConfig.roles,
        "main.author": {
          ...mockConfig.roles["main.author"],
          resolvedProvider: "deepseek",
        },
      },
      providers: [
        { provider: "deepseek", secretRef: "DEEPSEEK_API_KEY", enabled: true, capabilities: [] as never[] },
      ],
    };
    const model = createModelForRole(customConfig, "main.author", {
      apiKeys: { deepseek: "sk-deep-test" },
    });
    expect((model as any).sdk).toBe("openai-compatible");
  });
});
