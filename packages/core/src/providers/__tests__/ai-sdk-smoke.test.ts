import { describe, it, expect } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Smoke tests to verify Vercel AI SDK imports work and providers
 * can be instantiated. These do NOT make real API calls.
 */
describe("Vercel AI SDK smoke", () => {
  it("creates OpenAI provider instance", () => {
    const openai = createOpenAI({ apiKey: "test-key" });
    expect(openai).toBeDefined();
    const model = openai("gpt-4o");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("creates Anthropic provider instance", () => {
    const anthropic = createAnthropic({ apiKey: "test-key" });
    expect(anthropic).toBeDefined();
    const model = anthropic("claude-opus-4-6");
    expect(model.modelId).toBe("claude-opus-4-6");
  });

  it("creates OpenAI-compatible provider for local models", () => {
    const provider = createOpenAICompatible({
      name: "ollama",
      baseURL: "http://localhost:11434/v1",
    });
    expect(provider).toBeDefined();
    const model = provider.chatModel("llama3");
    expect(model.modelId).toBe("llama3");
  });

  it("tool definition schema is available from ai package", async () => {
    const { tool } = await import("ai");
    expect(tool).toBeDefined();
    expect(typeof tool).toBe("function");
  });

  it("streamText is available from ai package", async () => {
    const { streamText } = await import("ai");
    expect(streamText).toBeDefined();
    expect(typeof streamText).toBe("function");
  });

  it("generateObject is available from ai package", async () => {
    const { generateObject } = await import("ai");
    expect(generateObject).toBeDefined();
    expect(typeof generateObject).toBe("function");
  });
});
