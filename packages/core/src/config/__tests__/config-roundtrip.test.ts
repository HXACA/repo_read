import { describe, it, expect } from "vitest";
import { parseUserEditableConfig } from "../schema.js";

describe("config round-trip", () => {
  it("preserves all fields through Zod parse", () => {
    const input = {
      projectSlug: "test",
      repoRoot: "/tmp",
      preset: "quality",
      language: "zh",
      providers: [{
        provider: "openrouter",
        npm: "@ai-sdk/openai-compatible",
        secretRef: "KEY",
        apiKey: "sk-test",
        baseUrl: "https://example.com",
        enabled: true,
      }],
      roles: {
        "catalog": { model: "openrouter/qwen", fallback_models: [] },
        "outline": { model: "openrouter/qwen", fallback_models: [] },
        "drafter": { model: "openrouter/qwen", fallback_models: [] },
        "worker": { model: "openrouter/qwen", fallback_models: [] },
        "reviewer": { model: "glm/glm-5.1", fallback_models: [] },
      },
      qualityOverrides: { catalogMaxSteps: 80, workerMaxSteps: 10 },
    };

    const parsed = parseUserEditableConfig(input);
    // Provider fields preserved
    expect(parsed.providers[0].npm).toBe("@ai-sdk/openai-compatible");
    expect(parsed.providers[0].apiKey).toBe("sk-test");
    expect(parsed.providers[0].baseUrl).toBe("https://example.com");
    // Role is just model + fallback_models — protocol comes from provider
    expect(parsed.roles["catalog"].model).toBe("openrouter/qwen");
    // Quality overrides preserved
    expect(parsed.qualityOverrides?.catalogMaxSteps).toBe(80);
    expect(parsed.qualityOverrides?.workerMaxSteps).toBe(10);
  });
});
