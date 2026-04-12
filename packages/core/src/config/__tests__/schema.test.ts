import { describe, it, expect } from "vitest";
import { parseUserEditableConfig } from "../schema.js";

describe("UserEditableConfigSchema", () => {
  const validConfig = {
    projectSlug: "my-project",
    repoRoot: "/home/user/repo",
    preset: "quality",
    providers: [
      { provider: "anthropic", secretRef: "key-1", enabled: true },
    ],
    roles: {
      "catalog": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
      "outline": { model: "claude-opus-4-6", fallback_models: [] },
      "drafter": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
      "worker": { model: "claude-sonnet-4-6", fallback_models: [] },
      "reviewer": { model: "claude-opus-4-6", fallback_models: [] },
    },
  };

  it("accepts valid config", () => {
    const result = parseUserEditableConfig(validConfig);
    expect(result.projectSlug).toBe("my-project");
    expect(result.preset).toBe("quality");
  });

  it("rejects unknown preset", () => {
    expect(() =>
      parseUserEditableConfig({ ...validConfig, preset: "turbo" }),
    ).toThrow();
  });

  it("rejects missing role", () => {
    const bad = {
      ...validConfig,
      roles: {
        "catalog": { model: "x", fallback_models: [] },
        "outline": { model: "x", fallback_models: [] },
        "drafter": { model: "x", fallback_models: [] },
        "worker": { model: "x", fallback_models: [] },
        // missing reviewer
      },
    };
    expect(() => parseUserEditableConfig(bad)).toThrow();
  });

  it("strips unknown fields on role without throwing", () => {
    const input = {
      ...validConfig,
      roles: {
        ...validConfig.roles,
        "catalog": {
          model: "x",
          fallback_models: [],
          customPrompt: "hack",
        },
      },
    };
    const parsed = parseUserEditableConfig(input);
    expect((parsed.roles["catalog"] as Record<string, unknown>).customPrompt).toBeUndefined();
  });

  it("accepts optional baseUrl on provider", () => {
    const config = {
      ...validConfig,
      providers: [
        { provider: "ollama", secretRef: "", baseUrl: "http://localhost:11434", enabled: true },
      ],
    };
    const result = parseUserEditableConfig(config);
    expect(result.providers[0].baseUrl).toBe("http://localhost:11434");
  });
});
