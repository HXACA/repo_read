import { describe, it, expect, afterEach } from "vitest";
import { resolveApiKeys } from "../resolve-api-keys.js";
import type { UserEditableConfig } from "../../types/config.js";

const baseConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp/repo",
  preset: "balanced",
  providers: [],
  roles: {
    "catalog": { model: "openrouter/gpt-4", fallback_models: [] },
    "outline": { model: "openrouter/gpt-4", fallback_models: [] },
    "drafter": { model: "openrouter/gpt-4", fallback_models: [] },
    "worker": { model: "openrouter/gpt-4", fallback_models: [] },
    "reviewer": { model: "openrouter/gpt-4", fallback_models: [] },
  },
};

describe("resolveApiKeys", () => {
  afterEach(() => {
    delete process.env.TEST_SECRET_A;
    delete process.env.TEST_SECRET_B;
  });

  it("uses config.apiKey when env var is not set", () => {
    const config: UserEditableConfig = {
      ...baseConfig,
      providers: [
        { provider: "openrouter", secretRef: "TEST_SECRET_A", apiKey: "cfg-key-123", enabled: true },
      ],
    };

    const keys = resolveApiKeys(config);
    expect(keys).toEqual({ openrouter: "cfg-key-123" });
  });

  it("prefers env var over config.apiKey", () => {
    process.env.TEST_SECRET_A = "env-key-456";
    const config: UserEditableConfig = {
      ...baseConfig,
      providers: [
        { provider: "openrouter", secretRef: "TEST_SECRET_A", apiKey: "cfg-key-123", enabled: true },
      ],
    };

    const keys = resolveApiKeys(config);
    expect(keys).toEqual({ openrouter: "env-key-456" });
  });

  it("skips disabled providers", () => {
    process.env.TEST_SECRET_B = "env-key-789";
    const config: UserEditableConfig = {
      ...baseConfig,
      providers: [
        { provider: "anthropic", secretRef: "TEST_SECRET_B", apiKey: "cfg-key-abc", enabled: false },
        { provider: "openrouter", secretRef: "TEST_SECRET_A", apiKey: "cfg-key-def", enabled: true },
      ],
    };

    const keys = resolveApiKeys(config);
    expect(keys).toEqual({ openrouter: "cfg-key-def" });
    expect(keys).not.toHaveProperty("anthropic");
  });
});
