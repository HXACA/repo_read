import { describe, it, expect } from "vitest";
import { ProviderCenter } from "../provider-center.js";
import type { UserEditableConfig } from "../../types/config.js";

const testConfig: UserEditableConfig = {
  projectSlug: "test",
  repoRoot: "/tmp",
  preset: "quality",
  providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
  roles: {
    "main.author": { model: "claude-opus-4-6", fallback_models: ["claude-sonnet-4-6"] },
    "fork.worker": { model: "claude-sonnet-4-6", fallback_models: [] },
    "fresh.reviewer": { model: "claude-opus-4-6", fallback_models: [] },
  },
};

describe("ProviderCenter", () => {
  it("resolves config with static capabilities", () => {
    const center = new ProviderCenter();
    const resolved = center.resolve(testConfig);
    expect(resolved.roles["main.author"].primaryModel).toBe("claude-opus-4-6");
    expect(resolved.roles["main.author"].systemPromptTuningId).toBe("anthropic-claude");
  });

  it("generates a human-readable routing summary", () => {
    const center = new ProviderCenter();
    const summary = center.summarize(testConfig);
    expect(summary).toContain("main.author");
    expect(summary).toContain("claude-opus-4-6");
  });
});
